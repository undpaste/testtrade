import { NextRequest, NextResponse } from 'next/server';
import { getMarketSnapshot, MarketAssetClass, MarketType } from '@/lib/marketData';

const assetClasses: MarketAssetClass[] = ['crypto', 'stock', 'etf', 'dex'];
const marketTypes: MarketType[] = ['crypto_spot', 'crypto_perp', 'dex_spot', 'stock', 'etf'];

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol')?.trim().toUpperCase();
  const assetClass = request.nextUrl.searchParams.get('assetClass') as MarketAssetClass | null;
  const marketType = request.nextUrl.searchParams.get('marketType') as MarketType | null;
  const poolAddress = request.nextUrl.searchParams.get('poolAddress') ?? undefined;
  const network = request.nextUrl.searchParams.get('network') ?? undefined;
  if (!symbol || !/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) {
    return NextResponse.json({ error: 'A valid market symbol is required' }, { status: 400 });
  }
  if (!assetClass || !assetClasses.includes(assetClass)) {
    return NextResponse.json({ error: 'Invalid asset class' }, { status: 400 });
  }
  if (marketType && !marketTypes.includes(marketType)) {
    return NextResponse.json({ error: 'Invalid market type' }, { status: 400 });
  }

  try {
    const snapshot = await getMarketSnapshot(assetClass, symbol, marketType ?? undefined, poolAddress, network);
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Market data is temporarily unavailable';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
