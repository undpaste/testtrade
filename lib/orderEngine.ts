import type { SupabaseClient } from '@supabase/supabase-js';
import {
  calculateFee,
  getMarketType,
  OrderContext,
  simulateFill,
  TradingAssetClass,
  TradingMarketType,
} from './realism';
import { detectRevengeTrading, isAccountDead, REVENGE_FREEZE_MIN } from './psychology';

export type PaperOrderType = 'market' | 'limit' | 'stop_loss' | 'take_profit' | 'trailing_stop';
export type PaperOrderSide = 'buy' | 'sell';

export type PlaceOrderInput = {
  userId: string;
  symbol: string;
  assetClass: TradingAssetClass;
  marketType: TradingMarketType;
  side: PaperOrderSide;
  orderType: PaperOrderType;
  qty: number;
  referencePrice: number;
  limitPrice?: number;
  triggerPrice?: number;
  trailingPercent?: number;
  reasonEntry: string;
  notes?: string;
  avgDailyVolume: number;
  poolLiquidityUsd?: number;
  recentVolatility: number;
  fundingRate: number;
  highVolatilityMode: boolean;
  leverage: number;
  book: { bids: Array<{ px: number; sz: number }>; asks: Array<{ px: number; sz: number }> };
  marketSnapshot: Record<string, unknown>;
  poolAddress?: string;
  network?: string;
  ocoGroupId?: string;
  orderId?: string;
};

function isTriggered(input: PlaceOrderInput, trailingAnchor?: number | null): boolean {
  const { orderType, side, referencePrice, limitPrice, triggerPrice, trailingPercent } = input;
  if (orderType === 'market') return true;
  if (orderType === 'limit') {
    const executablePrice = side === 'buy'
      ? (input.book.asks[0]?.px ?? referencePrice)
      : (input.book.bids[0]?.px ?? referencePrice);
    return side === 'buy'
      ? executablePrice <= (limitPrice ?? 0)
      : executablePrice >= (limitPrice ?? Number.POSITIVE_INFINITY);
  }
  if (orderType === 'stop_loss') {
    return side === 'buy'
      ? referencePrice >= (triggerPrice ?? Number.POSITIVE_INFINITY)
      : referencePrice <= (triggerPrice ?? 0);
  }
  if (orderType === 'take_profit') {
    return side === 'buy'
      ? referencePrice <= (triggerPrice ?? 0)
      : referencePrice >= (triggerPrice ?? Number.POSITIVE_INFINITY);
  }
  if (!trailingPercent || trailingPercent <= 0) return false;

  const anchor = trailingAnchor ?? referencePrice;
  return side === 'sell'
    ? referencePrice <= anchor * (1 - trailingPercent / 100)
    : referencePrice >= anchor * (1 + trailingPercent / 100);
}

function updatedTrailingAnchor(input: PlaceOrderInput, existingAnchor?: number | null): number {
  if (!existingAnchor) return input.referencePrice;
  return input.side === 'sell'
    ? Math.max(existingAnchor, input.referencePrice)
    : Math.min(existingAnchor, input.referencePrice);
}

export async function placeOrder({ supabase, input }: {
  supabase: SupabaseClient;
  input: PlaceOrderInput;
}) {
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id, balance, total_fees_paid, total_trades, equity, is_dead, dead_until, max_leverage')
    .eq('user_id', input.userId)
    .single();
  if (accountError) throw accountError;
  if (!account) throw new Error('Paper account not found');

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

  if (input.leverage > Number(account.max_leverage ?? 20)) {
    throw new Error(`Maximum account leverage is ${Number(account.max_leverage ?? 20)}×.`);
  }
  if (input.marketType !== 'crypto_perp' && input.marketType !== 'stock' && input.marketType !== 'etf' && input.leverage !== 1) {
    throw new Error('Leverage is only available for perpetual and margin-enabled equity markets.');
  }

  let existingOrder: {
    id: string;
    trailing_anchor: number | null;
  } | null = null;
  if (input.orderId) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, trailing_anchor')
      .eq('id', input.orderId)
      .eq('user_id', input.userId)
      .eq('status', 'pending')
      .single();
    if (error) throw error;
    existingOrder = data;
  }

  const { data: recentJournalEntries, error: journalQueryError } = await supabase
    .from('journal')
    .select('id, user_id, symbol, side, qty, entry_price, pnl, created_at')
    .eq('user_id', input.userId)
    .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false });
  if (journalQueryError) throw journalQueryError;
  const recentTrades = (recentJournalEntries ?? []).map((entry) => ({
    ...entry,
    side: entry.side as PaperOrderSide,
    price: Number(entry.entry_price),
    qty: Number(entry.qty),
    pnl: entry.pnl === null ? undefined : Number(entry.pnl),
  }));
  const revenge = detectRevengeTrading(recentTrades, {
    qty: input.qty, price: input.referencePrice, side: input.side,
  });

  if (revenge.triggered && !input.orderId) {
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

  const marketType = getMarketType(input);
  const quotePrice = input.side === 'buy'
    ? (input.book.asks[0]?.px ?? input.referencePrice)
    : (input.book.bids[0]?.px ?? input.referencePrice);
  const triggerInput = { ...input, referencePrice: input.referencePrice };
  const triggered = isTriggered(triggerInput, existingOrder?.trailing_anchor);

  if (!triggered) {
    const nextAnchor = input.orderType === 'trailing_stop'
      ? updatedTrailingAnchor(input, existingOrder?.trailing_anchor)
      : null;
    if (existingOrder && nextAnchor !== null) {
      const trigger = input.side === 'sell'
        ? nextAnchor * (1 - (input.trailingPercent ?? 0) / 100)
        : nextAnchor * (1 + (input.trailingPercent ?? 0) / 100);
      const { error } = await supabase.from('orders')
        .update({ trailing_anchor: nextAnchor, trigger_price: trigger })
        .eq('id', existingOrder.id)
        .eq('user_id', input.userId);
      if (error) throw error;
      return { pending: true, orderId: existingOrder.id, status: 'pending', trailingTrigger: trigger };
    }

    if (input.orderId) return { pending: true, orderId: input.orderId, status: 'pending' };
    const pendingContext: OrderContext = {
      symbol: input.symbol, assetClass: input.assetClass, marketType, side: input.side,
      orderType: 'market', qty: input.qty, requestedPrice: input.referencePrice,
      avgDailyVolume: input.avgDailyVolume, highVolatilityMode: input.highVolatilityMode,
      recentVolatility: input.recentVolatility,
    };
    const fees = calculateFee(pendingContext, input.referencePrice, input.qty, true);
    const { data, error } = await supabase.rpc('settle_paper_fill', {
      p_user_id: input.userId,
      p_order_id: null,
      p_symbol: input.symbol,
      p_asset_class: input.assetClass,
      p_market_type: marketType,
      p_side: input.side,
      p_order_type: input.orderType,
      p_requested_qty: input.qty,
      p_filled_qty: 0,
      p_reference_price: input.limitPrice ?? input.triggerPrice ?? input.referencePrice,
      p_fill_price: input.referencePrice,
      p_fee: 0,
      p_fee_breakdown: fees,
      p_slippage_pct: 0,
      p_leverage: input.leverage,
      p_trigger_price: input.triggerPrice ?? input.limitPrice ?? nextAnchor,
      p_trailing_percent: input.trailingPercent ?? null,
      p_reason_entry: input.reasonEntry,
      p_notes: input.notes ?? null,
      p_funding: 0,
      p_market_snapshot: input.marketSnapshot,
      p_pool_address: input.poolAddress ?? null,
      p_network: input.network ?? null,
      p_oco_group_id: input.ocoGroupId ?? null,
      p_latency_ms: 0,
    });
    if (error) throw error;
    return { ...(data as Record<string, unknown>), pending: true };
  }

  const context: OrderContext = {
    symbol: input.symbol,
    assetClass: input.assetClass,
    marketType,
    side: input.side,
    orderType: input.orderType === 'limit' ? 'limit' : 'market',
    qty: input.qty,
    requestedPrice: input.orderType === 'limit' ? (input.limitPrice ?? quotePrice) : quotePrice,
    avgDailyVolume: input.avgDailyVolume,
    highVolatilityMode: input.highVolatilityMode,
    recentVolatility: input.recentVolatility,
    book: input.book,
    poolLiquidityUsd: input.poolLiquidityUsd,
    makerMode: Boolean(input.orderId && input.orderType === 'limit'),
  };
  const fill = simulateFill(context);
  if (fill.filledQty <= 0) {
    if (input.orderId) return { pending: true, orderId: input.orderId, status: 'pending' };
    const fees = calculateFee(context, context.requestedPrice, 0, false);
    const { data, error } = await supabase.rpc('settle_paper_fill', {
      p_user_id: input.userId, p_order_id: null, p_symbol: input.symbol,
      p_asset_class: input.assetClass, p_market_type: marketType, p_side: input.side,
      p_order_type: input.orderType, p_requested_qty: input.qty, p_filled_qty: 0,
      p_reference_price: input.limitPrice ?? context.requestedPrice, p_fill_price: context.requestedPrice,
      p_fee: 0, p_fee_breakdown: fees, p_slippage_pct: 0, p_leverage: input.leverage,
      p_trigger_price: input.triggerPrice ?? input.limitPrice ?? null,
      p_trailing_percent: input.trailingPercent ?? null, p_reason_entry: input.reasonEntry,
      p_notes: input.notes ?? null, p_funding: 0, p_market_snapshot: input.marketSnapshot,
      p_pool_address: input.poolAddress ?? null, p_network: input.network ?? null,
      p_oco_group_id: input.ocoGroupId ?? null, p_latency_ms: 0,
    });
    if (error) throw error;
    return { ...(data as Record<string, unknown>), pending: true };
  }

  const { data: existingPosition, error: positionError } = await supabase
    .from('positions')
    .select('qty, avg_entry, opened_at')
    .eq('user_id', input.userId)
    .eq('symbol', input.symbol)
    .is('closed_at', null)
    .maybeSingle();
  if (positionError) throw positionError;
  const oldQuantity = Number(existingPosition?.qty ?? 0);
  const orderQuantity = input.side === 'buy' ? fill.filledQty : -fill.filledQty;
  const closingQuantity = oldQuantity !== 0 && Math.sign(oldQuantity) !== Math.sign(orderQuantity)
    ? Math.min(Math.abs(oldQuantity), fill.filledQty)
    : 0;
  const fundingPeriods = existingPosition
    ? Math.max(0, Math.floor(Date.now() / 28_800_000) - Math.floor(new Date(existingPosition.opened_at).getTime() / 28_800_000))
    : 0;
  const fundingPayment = closingQuantity * Number(existingPosition?.avg_entry ?? 0) *
    input.fundingRate * fundingPeriods * Math.sign(oldQuantity);

  const { data, error } = await supabase.rpc('settle_paper_fill', {
    p_user_id: input.userId,
    p_order_id: input.orderId ?? null,
    p_symbol: input.symbol,
    p_asset_class: input.assetClass,
    p_market_type: marketType,
    p_side: input.side,
    p_order_type: input.orderType,
    p_requested_qty: input.qty,
    p_filled_qty: fill.filledQty,
    p_reference_price: input.limitPrice ?? quotePrice,
    p_fill_price: fill.fillPrice,
    p_fee: fill.fee,
    p_fee_breakdown: fill.feeBreakdown,
    p_slippage_pct: fill.slippagePct,
    p_leverage: input.leverage,
    p_trigger_price: input.triggerPrice ?? input.limitPrice ?? null,
    p_trailing_percent: input.trailingPercent ?? null,
    p_reason_entry: input.reasonEntry,
    p_notes: input.notes ?? null,
    p_funding: fundingPayment,
    p_market_snapshot: input.marketSnapshot,
    p_pool_address: input.poolAddress ?? null,
    p_network: input.network ?? null,
    p_oco_group_id: input.ocoGroupId ?? null,
    p_latency_ms: fill.executionLatencyMs,
  });
  if (error) throw error;

  return {
    ...(data as Record<string, unknown>),
    fill,
    newBalance: Number((data as Record<string, unknown>).newBalance),
  };
}
