import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { placeOrder } from '@/lib/orderEngine';

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const sides = ['buy', 'sell'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function getOrderMarketData(symbol: string, side: 'buy' | 'sell') {
  const [marketResponse, bookResponse] = await Promise.all([
    fetch(HYPERLIQUID_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    }),
    fetch(HYPERLIQUID_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'l2Book', coin: symbol }),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    }),
  ]);
  if (!marketResponse.ok || !bookResponse.ok) throw new Error('Live market data is temporarily unavailable');

  const [result, book]: [unknown, { levels?: Array<Array<{ px: string; sz: string }>> }] =
    await Promise.all([marketResponse.json(), bookResponse.json()]);
  if (!Array.isArray(result) || !isRecord(result[0]) || !Array.isArray(result[0].universe) || !Array.isArray(result[1])) {
    throw new Error('Market data provider returned an invalid response');
  }

  const index = result[0].universe.findIndex((market: unknown) => isRecord(market) && market.name === symbol);
  const context = result[1][index];
  if (index < 0 || !isRecord(context)) throw new Error(`Market ${symbol} is not available`);

  const marketPrices: Record<string, number> = {};
  for (let marketIndex = 0; marketIndex < result[0].universe.length; marketIndex++) {
    const market = result[0].universe[marketIndex];
    const marketContext = result[1][marketIndex];
    if (!isRecord(market) || typeof market.name !== 'string' || !isRecord(marketContext)) continue;
    const markPrice = Number(marketContext.markPx ?? marketContext.midPx);
    if (Number.isFinite(markPrice) && markPrice > 0) marketPrices[market.name] = markPrice;
  }
  const midpoint = Number(context.midPx ?? context.markPx);
  const bestPrice = Number(book.levels?.[side === 'buy' ? 1 : 0]?.[0]?.px);
  const price = Number.isFinite(bestPrice) && bestPrice > 0 ? bestPrice : midpoint;
  const previousPrice = Number(context.prevDayPx);
  const volume = Number(context.dayNtlVlm);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(volume) || volume <= 0) {
    throw new Error(`Live quote for ${symbol} is not available`);
  }

  return {
    price,
    volume,
    fundingRate: Number(context.funding ?? 0),
    marketPrices,
    volatility: Number.isFinite(previousPrice) && previousPrice > 0
      ? Math.min(Math.abs((price / previousPrice) - 1), 0.05)
      : 0,
  };
}

export async function POST(req: NextRequest) {
  const authorization = req.headers.get('authorization');
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body: unknown = await req.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
    }

    const { symbol, side, qty, reasonEntry, notes, highVolatilityMode } = body;
    if (
      typeof symbol !== 'string' || !/^[A-Z0-9]{2,20}$/.test(symbol.trim()) ||
      typeof side !== 'string' || !sides.includes(side as typeof sides[number]) ||
      typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0 ||
      typeof reasonEntry !== 'string' || !reasonEntry.trim() ||
      typeof highVolatilityMode !== 'boolean' ||
      (notes !== undefined && typeof notes !== 'string')
    ) {
      return NextResponse.json({ error: 'Invalid order details' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase environment variables are not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    const market = await getOrderMarketData(symbol.trim(), side as typeof sides[number]);
    const result = await placeOrder({
      supabase,
      input: {
        userId: user.id,
        symbol: symbol.trim(),
        assetClass: 'crypto',
        side: side as typeof sides[number],
        orderType: 'market',
        qty,
        requestedPrice: market.price,
        reasonEntry: reasonEntry.trim(),
        notes: notes as string | undefined,
        avgDailyVolume: market.volume,
        marketPrices: market.marketPrices,
        recentVolatility: market.volatility,
        fundingRate: market.fundingRate,
        highVolatilityMode,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to place order';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
