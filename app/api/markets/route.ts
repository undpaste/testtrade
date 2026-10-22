import { NextRequest, NextResponse } from 'next/server';
import { getMarketCatalog, MarketAssetClass } from '@/lib/marketData';

const assetClasses: MarketAssetClass[] = ['crypto', 'stock', 'etf', 'dex'];

export async function GET(request: NextRequest) {
  const assetClass = request.nextUrl.searchParams.get('assetClass') as MarketAssetClass | null;
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!assetClass || !assetClasses.includes(assetClass)) {
    return NextResponse.json({ error: 'Choose crypto, stock, ETF, or DEX markets' }, { status: 400 });
  }
  if (query.length > 40) {
    return NextResponse.json({ error: 'Search query is too long' }, { status: 400 });
  }

  try {
    const markets = await getMarketCatalog(assetClass, query);
    return NextResponse.json({ markets, assetClass, updatedAt: Date.now() }, {
      headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=20' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Market catalog is temporarily unavailable';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
