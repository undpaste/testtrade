export type TradingAssetClass = 'crypto' | 'stock' | 'etf' | 'dex';
export type TradingMarketType = 'crypto_spot' | 'crypto_perp' | 'dex_spot' | 'stock' | 'etf';

export const FEE_SCHEDULE = {
  crypto_perp: { maker: 0.00015, taker: 0.00045 },
  crypto_spot: { maker: 0.001, taker: 0.001 },
  dex_spot: { maker: 0, taker: 0.003 },
  stock: { maker: 0, taker: 0 },
  etf: { maker: 0, taker: 0 },
} satisfies Record<TradingMarketType, { maker: number; taker: number }>;

export const STOCK_FEE_ASSUMPTIONS = {
  secSellRate: 0.0000278,
  finraPerShare: 0.000166,
  finraCap: 8.3,
  exchangePerShare: 0.0002,
  borrowApr: 0.08,
};

export const DEX_FEE_ASSUMPTIONS = {
  poolFeeRate: 0.003,
  gasUnits: 150_000,
  gasPriceGwei: 20,
  nativeTokenUsd: 3_000,
};

export const SLIPPAGE = {
  normal: { min: 0.00002, max: 0.002, typical: 0.0001 },
  volatile: { min: 0.0002, max: 0.015, typical: 0.001 },
};

export interface BookLevel {
  px: number;
  sz: number;
}

export interface OrderContext {
  symbol: string;
  assetClass: TradingAssetClass;
  marketType?: TradingMarketType;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  qty: number;
  requestedPrice: number;
  avgDailyVolume: number;
  highVolatilityMode: boolean;
  recentVolatility: number;
  book?: { bids: BookLevel[]; asks: BookLevel[] };
  poolLiquidityUsd?: number;
  makerMode?: boolean;
  gasPriceGwei?: number;
  nativeTokenUsd?: number;
}

export interface FeeBreakdown {
  tradingFee: number;
  regulatoryFee: number;
  exchangeFee: number;
  poolFee: number;
  gasFee: number;
  borrowFee: number;
  total: number;
  currency: string;
  maker: boolean;
}

export interface FillResult {
  fillPrice: number;
  filledQty: number;
  requestedQty: number;
  fillRatio: number;
  slippagePct: number;
  fee: number;
  feeTaker: boolean;
  partial: boolean;
  feeBreakdown: FeeBreakdown;
  executionLatencyMs: number;
}

export function getMarketType(ctx: Pick<OrderContext, 'assetClass' | 'marketType'>): TradingMarketType {
  if (ctx.marketType) return ctx.marketType;
  if (ctx.assetClass === 'stock' || ctx.assetClass === 'etf' || ctx.assetClass === 'dex') return ctx.assetClass === 'dex' ? 'dex_spot' : ctx.assetClass;
  return 'crypto_perp';
}

export function calculateSlippage(ctx: OrderContext): number {
  const schedule = ctx.highVolatilityMode ? SLIPPAGE.volatile : SLIPPAGE.normal;
  const notional = ctx.qty * ctx.requestedPrice;
  const liquidityRatio = notional / Math.max(ctx.avgDailyVolume, 1);
  const impact = Math.min(0.05, 0.1 * Math.sqrt(Math.max(0, liquidityRatio)));
  const volatilityImpact = Math.min(schedule.max, Math.max(0, ctx.recentVolatility) * 0.1);
  const randomSpread = Math.random() * (schedule.max - schedule.min);
  return Math.max(schedule.min, Math.min(schedule.max, schedule.typical + impact + volatilityImpact + randomSpread));
}

export function calculateFee(
  ctx: OrderContext,
  fillPrice: number,
  filledQty: number,
  makerMode = false
): FeeBreakdown {
  const marketType = getMarketType(ctx);
  const notional = fillPrice * filledQty;
  const schedule = FEE_SCHEDULE[marketType];
  const tradingFee = notional * (makerMode ? schedule.maker : schedule.taker);
  const isSell = ctx.side === 'sell';
  const regulatoryFee = marketType === 'stock' || marketType === 'etf'
    ? (isSell ? notional * STOCK_FEE_ASSUMPTIONS.secSellRate : 0) +
      (isSell ? Math.min(filledQty * STOCK_FEE_ASSUMPTIONS.finraPerShare, STOCK_FEE_ASSUMPTIONS.finraCap) : 0)
    : 0;
  const exchangeFee = marketType === 'stock' || marketType === 'etf'
    ? (isSell ? filledQty * STOCK_FEE_ASSUMPTIONS.exchangePerShare : 0)
    : 0;
  const poolFee = marketType === 'dex_spot' ? notional * DEX_FEE_ASSUMPTIONS.poolFeeRate : 0;
  const gasPriceGwei = ctx.gasPriceGwei ?? DEX_FEE_ASSUMPTIONS.gasPriceGwei;
  const nativeTokenUsd = ctx.nativeTokenUsd ?? DEX_FEE_ASSUMPTIONS.nativeTokenUsd;
  const gasFee = marketType === 'dex_spot'
    ? DEX_FEE_ASSUMPTIONS.gasUnits * gasPriceGwei * 1e-9 * nativeTokenUsd
    : 0;
  const borrowFee = ctx.side === 'sell' && (marketType === 'stock' || marketType === 'etf')
    ? notional * STOCK_FEE_ASSUMPTIONS.borrowApr / (365 * 24)
    : 0;

  return {
    tradingFee,
    regulatoryFee,
    exchangeFee,
    poolFee,
    gasFee,
    borrowFee,
    total: tradingFee + regulatoryFee + exchangeFee + poolFee + gasFee + borrowFee,
    currency: marketType === 'crypto_spot' ? 'USDT' : 'USD',
    maker: makerMode,
  };
}

export function calculateFillRatio(ctx: OrderContext): number {
  const notional = ctx.qty * ctx.requestedPrice;
  const participation = notional / Math.max(ctx.avgDailyVolume, 1);
  const modeledCapacity = Math.max(0.1, Math.min(1, 1 / (1 + Math.sqrt(participation) * 12)));
  return Math.max(0.1, Math.min(1, modeledCapacity - Math.random() * 0.04));
}

function fillAgainstBook(ctx: OrderContext, requestedQty: number): { quantity: number; averagePrice: number } | null {
  const levels = ctx.side === 'buy' ? ctx.book?.asks : ctx.book?.bids;
  if (!levels?.length) return null;

  let remaining = requestedQty;
  let notional = 0;
  let filled = 0;
  for (const level of levels) {
    if (remaining <= 0) break;
    if (!(level.px > 0) || !(level.sz > 0)) continue;
    if (ctx.orderType === 'limit' && (
      (ctx.side === 'buy' && level.px > ctx.requestedPrice) ||
      (ctx.side === 'sell' && level.px < ctx.requestedPrice)
    )) break;
    const quantity = Math.min(remaining, level.sz);
    remaining -= quantity;
    filled += quantity;
    notional += quantity * level.px;
  }
  return filled > 0 ? { quantity: filled, averagePrice: notional / filled } : { quantity: 0, averagePrice: ctx.requestedPrice };
}

export function simulateFill(ctx: OrderContext): FillResult {
  if (getMarketType(ctx) === 'dex_spot' && (ctx.poolLiquidityUsd ?? 0) > 0) {
    const reserveQuote = Number(ctx.poolLiquidityUsd) / 2;
    const reserveBase = reserveQuote / ctx.requestedPrice;
    const filledQty = Math.min(ctx.qty, reserveBase * 0.95);
    const quoteAmount = ctx.side === 'buy'
      ? (reserveQuote * filledQty) / Math.max(reserveBase - filledQty, reserveBase * 0.05)
      : (reserveQuote * filledQty) / (reserveBase + filledQty);
    const fillPrice = quoteAmount / Math.max(filledQty, Number.EPSILON);
    const slippagePct = Math.abs(fillPrice - ctx.requestedPrice) / ctx.requestedPrice;
    const feeBreakdown = calculateFee(ctx, fillPrice, filledQty, false);
    return {
      fillPrice,
      filledQty,
      requestedQty: ctx.qty,
      fillRatio: ctx.qty ? filledQty / ctx.qty : 0,
      slippagePct,
      fee: feeBreakdown.total,
      feeTaker: true,
      partial: filledQty < ctx.qty * 0.999,
      feeBreakdown,
      executionLatencyMs: Math.round(350 + Math.random() * 1_200),
    };
  }

  const depthFill = fillAgainstBook(ctx, ctx.qty);
  const schedule = ctx.highVolatilityMode ? SLIPPAGE.volatile : SLIPPAGE.normal;
  const slippagePct = depthFill
    ? Math.abs(depthFill.averagePrice - ctx.requestedPrice) / ctx.requestedPrice
    : calculateSlippage(ctx);
  const fillRatio = depthFill
    ? depthFill.quantity / ctx.qty
    : ctx.orderType === 'market' ? calculateFillRatio(ctx) : 1;
  const filledQty = ctx.orderType === 'limit' && !depthFill
    ? 0
    : ctx.orderType === 'market' && !depthFill
      ? ctx.qty * fillRatio
      : depthFill?.quantity ?? ctx.qty * fillRatio;
  const direction = ctx.side === 'buy' ? 1 : -1;
  const rawFillPrice = depthFill?.averagePrice ?? ctx.requestedPrice * (1 + direction * slippagePct);
  const fillPrice = ctx.orderType === 'limit' && !depthFill
    ? ctx.requestedPrice
    : Math.max(ctx.requestedPrice * (1 - schedule.max), Math.min(ctx.requestedPrice * (1 + schedule.max), rawFillPrice));
  const feeBreakdown = calculateFee(ctx, fillPrice, filledQty, ctx.makerMode ?? false);

  return {
    fillPrice,
    filledQty,
    requestedQty: ctx.qty,
    fillRatio: ctx.qty > 0 ? filledQty / ctx.qty : 0,
    slippagePct: ctx.orderType === 'limit' ? 0 : slippagePct,
    fee: feeBreakdown.total,
    feeTaker: !feeBreakdown.maker,
    partial: filledQty < ctx.qty * 0.999,
    feeBreakdown,
    executionLatencyMs: Math.round(35 + Math.random() * 125),
  };
}
