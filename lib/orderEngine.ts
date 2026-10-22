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
  marketPrices: Record<string, number>;
  recentVolatility: number;
  fundingRate: number;
  highVolatilityMode: boolean;
};

export async function placeOrder({ supabase, input }: {
  supabase: SupabaseClient;
  input: PlaceOrderInput;
}) {
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
  if (activeFreeze) throw new Error(`Trading is frozen until ${activeFreeze.frozen_until}.`);

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
    const frozenUntil = new Date(Date.now() + REVENGE_FREEZE_MIN * 60_000);
    const { error: revengeError } = await supabase.from('revenge_events').insert({
      user_id: input.userId,
      loss_amount: revenge.lossAmount,
      size_multiplier: revenge.sizeMult,
      frozen_until: frozenUntil.toISOString(),
    });
    if (revengeError) throw revengeError;
    throw new Error(`REVENGE_TRADING:${revenge.reason}||FREEZE_UNTIL:${frozenUntil.toISOString()}`);
  }

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

  const { data: existingPosition, error: positionQueryError } = await supabase
    .from('positions')
    .select('id, qty, avg_entry, realized_pnl, opened_at')
    .eq('user_id', input.userId)
    .eq('symbol', input.symbol)
    .is('closed_at', null)
    .maybeSingle();
  if (positionQueryError) throw positionQueryError;

  const oldQty = Number(existingPosition?.qty ?? 0);
  const oldEntry = Number(existingPosition?.avg_entry ?? 0);
  const signedOrderQty = input.side === 'buy' ? fill.filledQty : -fill.filledQty;
  const newQty = oldQty + signedOrderQty;
  const closesExisting = oldQty !== 0 && Math.sign(oldQty) !== Math.sign(signedOrderQty);
  const closingQty = closesExisting ? Math.min(Math.abs(oldQty), fill.filledQty) : 0;
  const openingQty = fill.filledQty - closingQty;
  const realizedBeforeFunding = closingQty > 0
    ? (fill.fillPrice - oldEntry) * closingQty * Math.sign(oldQty)
    : 0;
  const fundingPeriods = existingPosition
    ? Math.max(0, Math.floor(Date.now() / 28_800_000) - Math.floor(new Date(existingPosition.opened_at).getTime() / 28_800_000))
    : 0;
  const fundingPayment = closingQty * oldEntry * input.fundingRate * fundingPeriods * Math.sign(oldQty);
  const realizedPnl = realizedBeforeFunding - fundingPayment;

  const marginReleased = closingQty * oldEntry;
  const marginRequired = openingQty * fill.fillPrice;
  const feeTotal = fill.fee;
  const newBalance = Number(account.balance) + marginReleased + realizedPnl - marginRequired - feeTotal;
  if (newBalance < -1e-8) {
    throw new Error('Insufficient available paper balance for margin and fees.');
  }

  const { data: order, error: orderError } = await supabase.from('orders').insert({
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
  if (orderError) throw orderError;

  if (fill.filledQty > 0) {
    const remainsOldDirection = oldQty !== 0 && newQty !== 0 && Math.sign(oldQty) === Math.sign(newQty);
    const addsToPosition = oldQty !== 0 && Math.sign(oldQty) === Math.sign(signedOrderQty);
    const avgEntry = remainsOldDirection && !addsToPosition
      ? oldEntry
      : addsToPosition
        ? (Math.abs(oldQty) * oldEntry + fill.filledQty * fill.fillPrice) / Math.abs(newQty)
        : fill.fillPrice;
    const closed = Math.abs(newQty) < 1e-8;
    const positionValues = {
      qty: closed ? 0 : newQty,
      avg_entry: avgEntry,
      realized_pnl: Number(existingPosition?.realized_pnl ?? 0) + realizedPnl,
      closed_at: closed ? new Date().toISOString() : null,
      ...(existingPosition && oldQty !== 0 && Math.sign(oldQty) !== Math.sign(newQty)
        ? { opened_at: new Date().toISOString() }
        : {}),
    };

    if (existingPosition) {
      const { error: updatePositionError } = await supabase
        .from('positions')
        .update(positionValues)
        .eq('id', existingPosition.id);
      if (updatePositionError) throw updatePositionError;
    } else if (!closed) {
      const { error: insertPositionError } = await supabase.from('positions').insert({
        user_id: input.userId,
        symbol: input.symbol,
        asset_class: input.assetClass,
        ...positionValues,
      });
      if (insertPositionError) throw insertPositionError;
    }

    const { error: journalError } = await supabase.from('journal').insert({
      user_id: input.userId,
      order_id: order.id,
      symbol: input.symbol,
      side: input.side,
      qty: fill.filledQty,
      entry_price: fill.fillPrice,
      pnl: closingQty > 0 ? realizedPnl : null,
      reason_entry: input.reasonEntry,
      emotional_state: 'calm',
    });
    if (journalError) throw journalError;
  }

  const { data: positions, error: positionsError } = await supabase
    .from('positions')
    .select('symbol, qty, avg_entry')
    .eq('user_id', input.userId)
    .is('closed_at', null);
  if (positionsError) throw positionsError;

  const totalMargin = (positions ?? []).reduce(
    (total, position) => total + Math.abs(Number(position.qty) * Number(position.avg_entry)),
    0
  );
  const unrealizedPnl = (positions ?? []).reduce((total, position) => {
    const markPrice = position.symbol === input.symbol
      ? fill.fillPrice
      : input.marketPrices[position.symbol] ?? Number(position.avg_entry);
    return total + (markPrice - Number(position.avg_entry)) * Number(position.qty);
  }, 0);
  const equity = newBalance + totalMargin + unrealizedPnl;
  const accountUpdate: {
    balance: number;
    equity: number;
    total_fees_paid: number;
    total_trades: number;
    updated_at: string;
    is_dead?: boolean;
    dead_until?: string;
  } = {
    balance: newBalance,
    equity,
    total_fees_paid: Number(account.total_fees_paid ?? 0) + feeTotal,
    total_trades: Number(account.total_trades ?? 0) + 1,
    updated_at: new Date().toISOString(),
  };

  if (equity <= 0) {
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

  return { order, fill, newBalance, realizedPnl };
}
