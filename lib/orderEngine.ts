import type { SupabaseClient } from '@supabase/supabase-js';
import { simulateFill, OrderContext } from './realism';
import { detectRevengeTrading, isAccountDead, REVENGE_FREEZE_MIN } from './psychology';

type PlaceOrderInput = {
  userId: string;
  symbol: string;
  assetClass: 'crypto' | 'stock' | 'etf';
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  qty: number;
  requestedPrice: number;
  reasonEntry: string;
  notes?: string;
  avgDailyVolume: number;
  recentVolatility: number;
  highVolatilityMode: boolean;
};

export async function placeOrder({ supabase, input }: {
  supabase: SupabaseClient;
  input: PlaceOrderInput;
}) {
  // ============ CHECK 1: Account death lockout ============
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', input.userId)
    .single();

  if (accountError) throw accountError;
  if (!account) throw new Error('Account not found');

  const deathState = isAccountDead(account);
  if (deathState.dead) {
    throw new Error(`Account locked until ${deathState.until?.toISOString()}. ${deathState.reason}`);
  }

  const { data: activeFreeze, error: freezeError } = await supabase
    .from('revenge_events')
    .select('frozen_until')
    .eq('user_id', input.userId)
    .gt('frozen_until', new Date().toISOString())
    .order('frozen_until', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (freezeError) throw freezeError;
  if (activeFreeze) {
    throw new Error(`Trading is frozen until ${activeFreeze.frozen_until}.`);
  }

  // ============ CHECK 2: Revenge trading ============
  const { data: recentJournalEntries, error: journalQueryError } = await supabase
    .from('journal')
    .select('id, user_id, symbol, side, qty, entry_price, pnl, created_at')
    .eq('user_id', input.userId)
    .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false });
  if (journalQueryError) throw journalQueryError;

  const recentTrades = (recentJournalEntries || []).map((entry) => ({
    ...entry,
    side: entry.side as 'buy' | 'sell',
    price: Number(entry.entry_price),
    qty: Number(entry.qty),
    pnl: entry.pnl === null ? undefined : Number(entry.pnl),
  }));
  const revenge = detectRevengeTrading(recentTrades, {
    qty: input.qty, price: input.requestedPrice, side: input.side,
  });

  if (revenge.triggered) {
    const frozenUntil = new Date();
    frozenUntil.setMinutes(frozenUntil.getMinutes() + REVENGE_FREEZE_MIN);

    // Log event + freeze
    const { error: revengeError } = await supabase.from('revenge_events').insert({
      user_id: input.userId,
      loss_amount: revenge.lossAmount,
      size_multiplier: revenge.sizeMult,
      frozen_until: frozenUntil.toISOString(),
    });
    if (revengeError) throw revengeError;

    throw new Error(`REVENGE_TRADING:${revenge.reason}||FREEZE_UNTIL:${frozenUntil.toISOString()}`);
  }

  // ============ REALISM ENGINE ============
  const ctx: OrderContext = {
    symbol: input.symbol,
    assetClass: input.assetClass,
    side: input.side,
    orderType: input.orderType,
    qty: input.qty,
    requestedPrice: input.requestedPrice,
    avgDailyVolume: input.avgDailyVolume,
    highVolatilityMode: input.highVolatilityMode,
    recentVolatility: input.recentVolatility,
  };

  const fill = simulateFill(ctx);

  // ============ UPDATE ACCOUNT ============
  const orderValue = fill.fillPrice * fill.filledQty;
  const feeTotal = fill.fee;

  let newBalance = Number(account.balance);
  const newFees = Number(account.total_fees_paid ?? 0) + feeTotal;

  if (input.side === 'buy') {
    const totalCost = orderValue + feeTotal;
    if (totalCost > newBalance) {
      throw new Error('Insufficient balance (including slippage + fees)');
    }
    newBalance -= totalCost;
  } else {
    newBalance += orderValue - feeTotal;
  }

  // ============ PERSIST ============
  const { data: order, error: orderErr } = await supabase.from('orders').insert({
    user_id: input.userId,
    symbol: input.symbol,
    asset_class: input.assetClass,
    side: input.side,
    order_type: input.orderType,
    qty: input.qty,
    requested_price: input.requestedPrice,
    fill_price: fill.fillPrice,
    filled_qty: fill.filledQty,
    fee_paid: feeTotal,
    slippage_pct: fill.slippagePct,
    status: fill.filledQty === 0 ? 'rejected' : (fill.partial ? 'partial' : 'filled'),
    reason_entry: input.reasonEntry,
    notes: input.notes,
  }).select().single();

  if (orderErr) throw orderErr;

  // Auto-journal entry
  if (fill.filledQty > 0) {
    const { error: journalError } = await supabase.from('journal').insert({
      user_id: input.userId,
      order_id: order.id,
      symbol: input.symbol,
      side: input.side,
      qty: fill.filledQty,
      entry_price: fill.fillPrice,
      reason_entry: input.reasonEntry,
      emotional_state: 'calm',
    });
    if (journalError) throw journalError;
  }

  // Update account
  const accountUpdate: {
    balance: number;
    total_fees_paid: number;
    total_trades: number;
    updated_at: string;
    is_dead?: boolean;
    dead_until?: string;
  } = {
    balance: newBalance,
    total_fees_paid: newFees,
    total_trades: Number(account.total_trades ?? 0) + 1,
    updated_at: new Date().toISOString(),
  };

  if (newBalance <= 0) {
    const deadUntil = new Date();
    deadUntil.setDate(deadUntil.getDate() + 7);
    accountUpdate.is_dead = true;
    accountUpdate.dead_until = deadUntil.toISOString();
  }

  const { error: updateError } = await supabase
    .from('accounts')
    .update(accountUpdate)
    .eq('user_id', input.userId);
  if (updateError) throw updateError;

  return { order, fill, newBalance };
}