import { NextRequest, NextResponse } from 'next/server';

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';

type AssetContext = {
  dayNtlVlm?: string;
  funding?: string;
  markPx?: string;
  midPx?: string;
  openInterest?: string;
  prevDayPx?: string;
};

type AssetMetadata = {
  universe?: Array<{ name: string }>;
};

type Candle = {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
};

async function getInfo<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(HYPERLIQUID_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`Market data provider returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol') ?? 'BTC';
  if (!/^[A-Z0-9]{2,20}$/.test(symbol)) {
    return NextResponse.json({ error: 'Invalid market symbol' }, { status: 400 });
  }

  try {
    const now = Date.now();
    const [metaAndContexts, mids, book, candles] = await Promise.all([
      getInfo<[AssetMetadata, AssetContext[]]>({ type: 'metaAndAssetCtxs' }),
      getInfo<Record<string, string>>({ type: 'allMids' }),
      getInfo<{
        levels: Array<Array<{ px: string; sz: string; n: number }>>;
      }>({ type: 'l2Book', coin: symbol }),
      getInfo<Candle[]>({
        type: 'candleSnapshot',
        req: {
          coin: symbol,
          interval: '1m',
          startTime: now - 100 * 60_000,
          endTime: now,
        },
      }),
    ]);

    const [metadata, contexts] = metaAndContexts;
    const marketIndex = metadata.universe?.findIndex((market) => market.name === symbol) ?? -1;
    if (marketIndex < 0 || !contexts[marketIndex]) {
      return NextResponse.json({ error: `Market ${symbol} is not available` }, { status: 404 });
    }

    const markets = (metadata.universe ?? []).flatMap((market, index) => {
      const context = contexts[index];
      const markPrice = Number(context?.markPx ?? mids[market.name]);
      const previousPrice = Number(context?.prevDayPx);
      if (!Number.isFinite(markPrice) || markPrice <= 0) return [];

      return [{
        symbol: market.name,
        markPrice,
        change24hPct: Number.isFinite(previousPrice) && previousPrice > 0
          ? ((markPrice / previousPrice) - 1) * 100
          : 0,
        volume24h: Number(context?.dayNtlVlm ?? 0),
        fundingRate: Number(context?.funding ?? 0),
        openInterest: Number(context?.openInterest ?? 0),
      }];
    }).sort((a, b) => b.volume24h - a.volume24h);

    return NextResponse.json({
      source: 'Hyperliquid public market data',
      updatedAt: now,
      markets,
      selected: symbol,
      markPrice: Number(mids[symbol] ?? contexts[marketIndex].markPx),
      fundingRate: Number(contexts[marketIndex].funding ?? 0),
      book: {
        bids: book.levels?.[0] ?? [],
        asks: book.levels?.[1] ?? [],
      },
      candles: candles.map((candle) => ({
        time: candle.t,
        open: Number(candle.o),
        high: Number(candle.h),
        low: Number(candle.l),
        close: Number(candle.c),
        volume: Number(candle.v),
      })),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Market data is temporarily unavailable';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
