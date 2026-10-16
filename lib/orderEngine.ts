import { supabase } from './supabase';
import { simulateFill, OrderContext } from './realism';
import { detectRevengeTrading, isAccountDead, REVENGE_FREEZE_MIN } from './psychology';

export async function placeOrder(input: {
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
}) {
  // ============ CHECK 1: Account death lockout ============
  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', input.userId)
    .single();

  if (!account) throw new Error('Account not found');

  const deathState = isAccountDead(account);
  if (deathState.dead) {
    throw new Error(`Account locked until ${deathState.until?.toISOString()}. ${deathState.reason}`);
  }

  // ============ CHECK 2: Revenge trading ============
  const { data: recentOrders } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', input.userId)
    .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false });

  const revenge = detectRevengeTrading(recentOrders || [], {
    qty: input.qty, price: input.requestedPrice, side: input.side,
  });

  if (revenge.triggered) {
    const frozenUntil = new Date();
    frozenUntil.setMinutes(frozenUntil.getMinutes() + REVENGE_FREEZE_MIN);

    // Log event + freeze
    await supabase.from('revenge_events').insert({
      user_id: input.userId,
      loss_amount: revenge.lossAmount,
      size_multiplier: revenge.sizeMult,
      frozen_until: frozenUntil.toISOString(),
    });

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

  let newBalance = account.balance;
  let newFees = account.total_fees_paid + feeTotal;

  if (input.side === 'buy') {
    const totalCost = orderValue + feeTotal;
    if (totalCost > account.balance) {
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
    await supabase.from('journal').insert({
      user_id: input.userId,
      order_id: order.id,
      symbol: input.symbol,
      side: input.side,
      qty: fill.filledQty,
      entry_price: fill.fillPrice,
      reason_entry: input.reasonEntry,
      emotional_state: 'calm',
    });
  }

  // Update account
  await supabase.from('accounts').update({
    balance: newBalance,
    total_fees_paid: newFees,
    total_trades: account.total_trades + 1,
    updated_at: new Date().toISOString(),
  }).eq('user_id', input.userId);

  // Check for account death after trade
  if (newBalance <= 0) {
    const deadUntil = new Date();
    deadUntil.setDate(deadUntil.getDate() + 7);
    await supabase.from('accounts').update({
      is_dead: true,
      dead_until: deadUntil.toISOString(),
    }).eq('user_id', input.userId);
  }

  return { order, fill, newBalance };
}