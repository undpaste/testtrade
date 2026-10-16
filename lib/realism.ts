// =====================================================
// REALITY ENGINE: Slippage, Fees, Partial Fills
// =====================================================

// Fee structure realistic per asset class
export const FEE_SCHEDULE = {
  crypto: { maker: 0.0008, taker: 0.0010 },   // Binance-like
  stock:  { maker: 0.0000, taker: 0.0002 },   // commission-free + SEC fee
  etf:    { maker: 0.0000, taker: 0.0002 },
};

// Slippage distribution calibrated to real exchange data
export const SLIPPAGE = {
  normal:   { min: 0.0005, max: 0.0020, typical: 0.0010 }, // 0.05-0.20%
  volatile: { min: 0.0020, max: 0.0150, typical: 0.0050 }, // 0.20-1.50%
};

export interface OrderContext {
  symbol: string;
  assetClass: 'crypto' | 'stock' | 'etf';
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  qty: number;
  requestedPrice: number;
  avgDailyVolume: number;    // in USD terms
  highVolatilityMode: boolean;
  recentVolatility: number;  // 0-1, scaled
}

export interface FillResult {
  fillPrice: number;
  filledQty: number;
  requestedQty: number;
  fillRatio: number;         // 0-1
  slippagePct: number;
  fee: number;
  feeTaker: boolean;
  partial: boolean;
}

// =====================================================
// SLIPPAGE MODEL
// =====================================================
export function calculateSlippage(ctx: OrderContext): number {
  const schedule = ctx.highVolatilityMode ? SLIPPAGE.volatile : SLIPPAGE.normal;

  // Base slippage: skewed toward typical
  const base = schedule.typical;

  // Size impact: bigger orders slip more
  const orderValueUSD = ctx.qty * ctx.requestedPrice;
  const sizeRatio = orderValueUSD / Math.max(ctx.avgDailyVolume, 1);
  // Impact grows sub-linearly: sqrt-like curve
  const sizeImpact = Math.sqrt(Math.min(sizeRatio, 0.5)) * 0.5;

  // Volatility impact
  const volImpact = ctx.recentVolatility * 0.3;

  // Random component (market microstructure is noisy)
  const noise = (Math.random() - 0.5) * (schedule.max - schedule.min);

  let slippage = base + sizeImpact + volImpact + noise;
  slippage = Math.max(schedule.min, Math.min(schedule.max, slippage));

  return slippage;
}

// =====================================================
// PARTIAL FILL MODEL
// =====================================================
export function calculateFillRatio(ctx: OrderContext): number {
  const orderValueUSD = ctx.qty * ctx.requestedPrice;
  const sizeRatio = orderValueUSD / Math.max(ctx.avgDailyVolume, 1);

  // Orders > 0.5% of ADV start showing partial fills
  if (sizeRatio < 0.005) return 1.0;

  // Model: fill ratio decays with size
  // 1% of ADV -> ~90% fill
  // 5% of ADV -> ~50% fill
  // 10%+ of ADV -> ~25% fill
  const baseRatio = 1 / (1 + sizeRatio * 15);

  // Add randomness
  const noise = (Math.random() - 0.5) * 0.15;
  const ratio = baseRatio + noise;

  return Math.max(0.15, Math.min(1.0, ratio));
}

// =====================================================
// FEE MODEL
// =====================================================
export function calculateFee(
  ctx: OrderContext,
  fillPrice: number,
  filledQty: number,
  makerMode: boolean = false
): { fee: number; taker: boolean } {
  const schedule = FEE_SCHEDULE[ctx.assetClass];
  const isTaker = ctx.orderType === 'market' || !makerMode;
  const rate = isTaker ? schedule.taker : schedule.maker;
  const notional = fillPrice * filledQty;
  return { fee: notional * rate, taker: isTaker };
}

// =====================================================
// MAIN: EXECUTE ORDER WITH REALISM
// =====================================================
export function simulateFill(ctx: OrderContext): FillResult {
  // 1. Compute slippage
  const slippagePct = calculateSlippage(ctx);

  // 2. Apply slippage directionally
  // Buy: worse = higher price. Sell: worse = lower price.
  const direction = ctx.side === 'buy' ? 1 : -1;
  let fillPrice = ctx.requestedPrice * (1 + direction * slippagePct);

  // For limit orders: only fill if price crosses limit
  if (ctx.orderType === 'limit') {
    const limit = ctx.requestedPrice;
    if (ctx.side === 'buy' && fillPrice > limit) {
      // Price moved away from limit — no fill
      return {
        fillPrice: limit, filledQty: 0, requestedQty: ctx.qty,
        fillRatio: 0, slippagePct: 0, fee: 0, feeTaker: false, partial: false,
      };
    }
    if (ctx.side === 'sell' && fillPrice < limit) {
      return {
        fillPrice: limit, filledQty: 0, requestedQty: ctx.qty,
        fillRatio: 0, slippagePct: 0, fee: 0, feeTaker: false, partial: false,
      };
    }
    // For limit orders, no slippage (you get your limit or better)
    fillPrice = limit;
  }

  // 3. Compute fill ratio (partial fills)
  const fillRatio = ctx.orderType === 'market' ? calculateFillRatio(ctx) : 1.0;
  const filledQty = ctx.qty * fillRatio;

  // 4. Compute fees
  const makerMode = ctx.orderType === 'limit';
  const { fee, taker } = calculateFee(ctx, fillPrice, filledQty, makerMode);

  return {
    fillPrice,
    filledQty,
    requestedQty: ctx.qty,
    fillRatio,
    slippagePct: ctx.orderType === 'market' ? slippagePct : 0,
    fee,
    feeTaker: taker,
    partial: fillRatio < 0.99,
  };
}