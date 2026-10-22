// =====================================================
// PSYCHOLOGY ENFORCERS
// =====================================================

export const ACCOUNT_DEATH_DAYS = 7;
export const REVENGE_LOOKBACK_MIN = 30;       // window after loss
export const REVENGE_SIZE_MULT = 1.8;         // order size spike threshold
export const REVENGE_FREEZE_MIN = 10;         // freeze duration

export interface TradeRecord {
  id: string;
  user_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  pnl?: number;
  created_at: string;
}

// =====================================================
// ACCOUNT DEATH MODE
// =====================================================
export function isAccountDead(account: {
  balance: number;
  equity: number;
  is_dead: boolean;
  dead_until: string | null;
}): { dead: boolean; until: Date | null; reason?: string } {
  if (account.dead_until && new Date(account.dead_until) > new Date()) {
    return {
      dead: true,
      until: new Date(account.dead_until),
      reason: 'Account blown. Cooling-off period active.',
    };
  }

  // Check fresh blow-up
  if (account.balance <= 0 && !account.is_dead) {
    const deadUntil = new Date();
    deadUntil.setDate(deadUntil.getDate() + ACCOUNT_DEATH_DAYS);
    return {
      dead: true,
      until: deadUntil,
      reason: 'Account blown. 7-day lockout.',
    };
  }

  return { dead: false, until: null };
}

export function markAccountDead() {
  const deadUntil = new Date();
  deadUntil.setDate(deadUntil.getDate() + ACCOUNT_DEATH_DAYS);
  return { is_dead: true, dead_until: deadUntil.toISOString() };
}

// =====================================================
// REVENGE TRADING DETECTOR
// =====================================================
export function detectRevengeTrading(
  recentTrades: TradeRecord[],
  newOrder: { qty: number; price: number; side: 'buy' | 'sell' }
): { triggered: boolean; lossAmount?: number; sizeMult?: number; reason?: string } {
  const now = new Date();
  const cutoff = new Date(now.getTime() - REVENGE_LOOKBACK_MIN * 60 * 1000);

  // Find losses in lookback window
  const recentLosses = recentTrades.filter(t =>
    new Date(t.created_at) > cutoff &&
    t.pnl !== undefined && t.pnl < 0
  );

  if (recentLosses.length === 0) return { triggered: false };

  // Get the most recent big loss
  const lastLoss = recentLosses.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0];

  const lastLossValue = Math.abs(lastLoss.pnl || 0);
  const lastLossNotional = lastLoss.qty * lastLoss.price;

  // New order size
  const newNotional = newOrder.qty * newOrder.price;
  const sizeMultiplier = newNotional / Math.max(lastLossNotional, 1);

  // Revenge if: size > 1.8x previous AND loss was significant (>1% of account)
  if (sizeMultiplier >= REVENGE_SIZE_MULT) {
    return {
      triggered: true,
      lossAmount: lastLossValue,
      sizeMult: sizeMultiplier,
      reason: `Position size is ${sizeMultiplier.toFixed(1)}× your last trade — classic revenge pattern.`,
    };
  }

  return { triggered: false };
}

// =====================================================
// REAL MONEY EQUIVALENT WIDGET
// =====================================================
export interface RealMoneyContext {
  currency: 'IDR' | 'USD';
  monthlyRent: number;         // in local currency
  hourlyWage: number;          // in local currency
  usdToLocal: number;          // conversion
}

export const REALITY_PRESETS: Record<string, RealMoneyContext> = {
  'US': {
    currency: 'USD', monthlyRent: 1800, hourlyWage: 15, usdToLocal: 1,
  },
  'ID': {
    currency: 'IDR', monthlyRent: 3000000, hourlyWage: 50000, usdToLocal: 15800,
  },
};

export function realMoneyEquivalent(pnlUSD: number, ctx: RealMoneyContext) {
  const pnlLocal = pnlUSD * ctx.usdToLocal;
  const rentMonths = pnlLocal / ctx.monthlyRent;
  const workHours = Math.abs(pnlLocal) / ctx.hourlyWage;

  return {
    pnlLocal,
    rentMonths,
    workHours,
    label:
      Math.abs(rentMonths) >= 1
        ? `${Math.abs(rentMonths).toFixed(1)} months of rent`
        : `${workHours.toFixed(0)} hours of minimum wage work`,
  };
}