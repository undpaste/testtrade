import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getMarketSnapshot, MarketAssetClass, MarketType } from '@/lib/marketData';
import { PaperOrderSide, PaperOrderType, placeOrder } from '@/lib/orderEngine';
import { TradingAssetClass } from '@/lib/realism';

const marketTypes: MarketType[] = ['crypto_spot', 'crypto_perp', 'dex_spot', 'stock', 'etf'];

export async function POST(request: NextRequest) {
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

    const { data: pendingOrders, error: ordersError } = await supabase
      .from('orders')
      .select('id, symbol, asset_class, market_type, side, order_type, qty, requested_price, trigger_price, trailing_percent, trailing_anchor, reason_entry, notes, leverage, oco_group_id, pool_address, network')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);
    if (ordersError) throw ordersError;

    const snapshots = new Map<string, ReturnType<typeof getMarketSnapshot>>();
    const results: Array<{ orderId: string; result?: unknown; error?: string }> = [];
    const pending = pendingOrders ?? [];
    for (let offset = 0; offset < pending.length; offset += 5) {
      const batch = pending.slice(offset, offset + 5);
      const batchResults = await Promise.all(batch.map(async (order) => {
        if (!marketTypes.includes(order.market_type as MarketType)) {
          return { orderId: order.id, error: `Unsupported market type ${order.market_type}` };
        }
        try {
          const snapshotKey = [
            order.asset_class, order.market_type, order.symbol, order.pool_address ?? '', order.network ?? '',
          ].join(':');
          let snapshotPromise = snapshots.get(snapshotKey);
          if (!snapshotPromise) {
            snapshotPromise = getMarketSnapshot(
              order.asset_class as MarketAssetClass,
              order.symbol,
              order.market_type as MarketType,
              order.pool_address ?? undefined,
              order.network ?? undefined
            );
            snapshots.set(snapshotKey, snapshotPromise);
          }
          const snapshot = await snapshotPromise;
          const result = await placeOrder({
            supabase,
            input: {
              userId: user.id,
              orderId: order.id,
              symbol: order.symbol,
              assetClass: order.asset_class as TradingAssetClass,
              marketType: order.market_type as MarketType,
              side: order.side as PaperOrderSide,
              orderType: order.order_type as PaperOrderType,
              qty: Number(order.qty),
              referencePrice: snapshot.market.markPrice,
              limitPrice: order.order_type === 'limit' ? Number(order.requested_price) : undefined,
              triggerPrice: order.trigger_price === null ? undefined : Number(order.trigger_price),
              trailingPercent: order.trailing_percent === null ? undefined : Number(order.trailing_percent),
              reasonEntry: order.reason_entry ?? 'conditional_order',
              notes: order.notes ?? undefined,
              avgDailyVolume: snapshot.market.volume24h,
              poolLiquidityUsd: snapshot.market.liquidityUsd,
              recentVolatility: Math.min(Math.abs(snapshot.market.change24hPct / 100), 0.05),
              fundingRate: snapshot.market.fundingRate,
              highVolatilityMode: false,
              leverage: Number(order.leverage ?? 1),
              book: {
                bids: snapshot.book.bids.map((level) => ({ px: Number(level.px), sz: Number(level.sz) })),
                asks: snapshot.book.asks.map((level) => ({ px: Number(level.px), sz: Number(level.sz) })),
              },
              marketSnapshot: {
                source: snapshot.source,
                bookSource: snapshot.bookSource,
                observedAt: snapshot.updatedAt,
                markPrice: snapshot.market.markPrice,
              },
              poolAddress: order.pool_address ?? undefined,
              network: order.network ?? undefined,
              ocoGroupId: order.oco_group_id ?? undefined,
            },
          });
          return { orderId: order.id, result };
        } catch (error) {
          return { orderId: order.id, error: error instanceof Error ? error.message : String(error) };
        }
      }));
      results.push(...batchResults);
    }

    return NextResponse.json({ evaluated: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to evaluate pending paper orders';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
