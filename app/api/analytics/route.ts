import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase environment variables are not configured');

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

    const [{ data: trades, error: tradesError }, { data: account, error: accountError }] = await Promise.all([
      supabase.from('closed_trades')
        .select('id, symbol, side, quantity, gross_pnl, fees, funding, net_pnl, closed_at')
        .eq('user_id', user.id)
        .order('closed_at', { ascending: true })
        .limit(5000),
      supabase.from('accounts').select('balance, equity, total_fees_paid').eq('user_id', user.id).single(),
    ]);
    if (tradesError) throw tradesError;
    if (accountError) throw accountError;

    const rows = trades ?? [];
    const pnls = rows.map((trade) => Number(trade.net_pnl));
    const winners = pnls.filter((pnl) => pnl > 0);
    const losers = pnls.filter((pnl) => pnl < 0);
    const totalProfit = winners.reduce((sum, pnl) => sum + pnl, 0);
    const totalLoss = Math.abs(losers.reduce((sum, pnl) => sum + pnl, 0));
    const netPnl = pnls.reduce((sum, pnl) => sum + pnl, 0);
    const dailyPnl = new Map<string, number>();
    for (const trade of rows) {
      const day = trade.closed_at.slice(0, 10);
      dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + Number(trade.net_pnl));
    }

    let curve = 1000;
    let peak = curve;
    let maxDrawdown = 0;
    const equityCurve = Array.from(dailyPnl, ([date, pnl]) => {
      curve += pnl;
      peak = Math.max(peak, curve);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - curve) / peak);
      return { date, pnl, equity: curve };
    });

    const returns = equityCurve.map((point, index) => {
      const previous = index === 0 ? 1000 : equityCurve[index - 1].equity;
      return previous > 0 ? point.pnl / previous : 0;
    });
    const meanReturn = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
    const variance = returns.length > 1
      ? returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / (returns.length - 1)
      : 0;
    const sharpeRatio = variance > 0 ? (meanReturn / Math.sqrt(variance)) * Math.sqrt(252) : null;
    let currentStreak = 0;
    let bestStreak = 0;
    for (const pnl of pnls) {
      currentStreak = pnl > 0 ? Math.max(1, currentStreak + 1) : 0;
      bestStreak = Math.max(bestStreak, currentStreak);
    }

    return NextResponse.json({
      metrics: {
        totalClosedTrades: rows.length,
        winningTrades: winners.length,
        losingTrades: losers.length,
        winRate: rows.length ? (winners.length / rows.length) * 100 : 0,
        netPnl,
        averageWin: winners.length ? totalProfit / winners.length : 0,
        averageLoss: losers.length ? totalLoss / losers.length : 0,
        profitFactor: totalLoss ? totalProfit / totalLoss : null,
        maxDrawdownPct: maxDrawdown * 100,
        sharpeRatio,
        bestWinStreak: bestStreak,
        totalFeesPaid: Number(account.total_fees_paid ?? 0),
        cashBalance: Number(account.balance),
        equity: Number(account.equity),
      },
      equityCurve,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to calculate trading analytics';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
