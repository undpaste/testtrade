import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getMarketSnapshot, MarketAssetClass, MarketType } from '@/lib/marketData';
import { placeOrder, PaperOrderSide, PaperOrderType } from '@/lib/orderEngine';
import { TradingAssetClass } from '@/lib/realism';

const assetClasses: MarketAssetClass[] = ['crypto', 'stock', 'etf', 'dex'];
const marketTypes: MarketType[] = ['crypto_spot', 'crypto_perp', 'dex_spot', 'stock', 'etf'];
const sides: PaperOrderSide[] = ['buy', 'sell'];
const orderTypes: PaperOrderType[] = ['market', 'limit', 'stop_loss', 'take_profit', 'trailing_stop'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export async function POST(request: NextRequest) {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });

    const { symbol, assetClass, marketType, side, orderType, qty, reasonEntry, notes, highVolatilityMode } = body;
    const limitPrice = body.limitPrice;
    const triggerPrice = body.triggerPrice;
    const trailingPercent = body.trailingPercent;
    const leverage = body.leverage ?? 1;
    const poolAddress = body.poolAddress;
    const network = body.network;
    const isOco = body.orderType === 'oco';
    if (
      typeof symbol !== 'string' || !/^[A-Z0-9.^=-]{1,20}$/.test(symbol.trim()) ||
      typeof assetClass !== 'string' || !assetClasses.includes(assetClass as MarketAssetClass) ||
      typeof marketType !== 'string' || !marketTypes.includes(marketType as MarketType) ||
      typeof side !== 'string' || !sides.includes(side as PaperOrderSide) ||
      (!isOco && (typeof orderType !== 'string' || !orderTypes.includes(orderType as PaperOrderType))) ||
      !finitePositive(qty) ||
      typeof reasonEntry !== 'string' || !reasonEntry.trim() ||
      typeof highVolatilityMode !== 'boolean' ||
      (notes !== undefined && typeof notes !== 'string') ||
      typeof leverage !== 'number' || !Number.isFinite(leverage) || leverage < 1 || leverage > 20 ||
      (orderType === 'limit' && !finitePositive(limitPrice)) ||
      ((orderType === 'stop_loss' || orderType === 'take_profit') && !finitePositive(triggerPrice)) ||
      (orderType === 'trailing_stop' && (typeof trailingPercent !== 'number' || !Number.isFinite(trailingPercent) || trailingPercent <= 0 || trailingPercent > 50)) ||
      (isOco && (!finitePositive(body.takeProfitPrice) || !finitePositive(body.stopLossPrice)))
    ) {
      return NextResponse.json({ error: 'Invalid order details' }, { status: 400 });
    }

    if ((assetClass === 'stock' || assetClass === 'etf') && marketType !== assetClass) {
      return NextResponse.json({ error: 'Asset class and market type do not match' }, { status: 400 });
    }
    if (assetClass === 'crypto' && marketType !== 'crypto_perp' && marketType !== 'crypto_spot') {
      return NextResponse.json({ error: 'Choose a supported crypto market' }, { status: 400 });
    }
    if (assetClass === 'dex' && (marketType !== 'dex_spot' || typeof poolAddress !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(poolAddress))) {
      return NextResponse.json({ error: 'A valid DEX pool is required' }, { status: 400 });
    }
    if ((marketType === 'crypto_spot' || marketType === 'dex_spot') && leverage !== 1) {
      return NextResponse.json({ error: 'Spot markets do not support leverage' }, { status: 400 });
    }
    if ((marketType === 'stock' || marketType === 'etf') && leverage > 2) {
      return NextResponse.json({ error: 'Equity paper margin is limited to 2×' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase environment variables are not configured');

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

    const snapshot = await getMarketSnapshot(
      assetClass as MarketAssetClass,
      symbol.trim().toUpperCase(),
      marketType as MarketType,
      typeof poolAddress === 'string' ? poolAddress : undefined,
      typeof network === 'string' ? network : undefined
    );
    const book = {
      bids: snapshot.book.bids.map((level) => ({ px: Number(level.px), sz: Number(level.sz) })),
      asks: snapshot.book.asks.map((level) => ({ px: Number(level.px), sz: Number(level.sz) })),
    };
    const referencePrice = snapshot.market.markPrice;
    if (
      (isOco && (
        side === 'sell'
          ? !(Number(body.takeProfitPrice) > referencePrice && Number(body.stopLossPrice) < referencePrice)
          : !(Number(body.takeProfitPrice) < referencePrice && Number(body.stopLossPrice) > referencePrice)
      )) ||
      (orderType === 'stop_loss' && (
        side === 'sell' ? Number(triggerPrice) >= referencePrice : Number(triggerPrice) <= referencePrice
      )) ||
      (orderType === 'take_profit' && (
        side === 'sell' ? Number(triggerPrice) <= referencePrice : Number(triggerPrice) >= referencePrice
      ))
    ) {
      return NextResponse.json({ error: 'Trigger prices must be on the correct side of the current market price' }, { status: 400 });
    }
    const common = {
      userId: user.id,
      symbol: snapshot.market.symbol,
      assetClass: assetClass as TradingAssetClass,
      marketType: marketType as MarketType,
      side: side as PaperOrderSide,
      qty,
      reasonEntry: reasonEntry.trim(),
      notes: notes as string | undefined,
      avgDailyVolume: snapshot.market.volume24h,
      poolLiquidityUsd: snapshot.market.liquidityUsd,
      recentVolatility: Math.min(Math.abs(snapshot.market.change24hPct / 100), 0.05),
      fundingRate: snapshot.market.fundingRate,
      highVolatilityMode,
      leverage,
      referencePrice,
      book,
      marketSnapshot: {
        source: snapshot.source,
        bookSource: snapshot.bookSource,
        observedAt: snapshot.updatedAt,
        markPrice: snapshot.market.markPrice,
        change24hPct: snapshot.market.change24hPct,
        volume24h: snapshot.market.volume24h,
        fundingRate: snapshot.market.fundingRate,
      },
      poolAddress: snapshot.market.poolAddress,
      network: snapshot.market.network,
    };

    if (isOco) {
      const { data, error } = await supabase.rpc('create_paper_oco_order', {
        p_user_id: user.id,
        p_symbol: snapshot.market.symbol,
        p_asset_class: assetClass,
        p_market_type: marketType,
        p_side: side,
        p_qty: qty,
        p_reference_price: referencePrice,
        p_take_profit_price: body.takeProfitPrice,
        p_stop_loss_price: body.stopLossPrice,
        p_reason_entry: reasonEntry.trim(),
        p_notes: typeof notes === 'string' ? notes : null,
        p_leverage: leverage,
        p_pool_address: snapshot.market.poolAddress ?? null,
        p_network: snapshot.market.network ?? null,
      });
      if (error) throw error;
      return NextResponse.json({ pending: true, ...(data as Record<string, unknown>) });
    }

    const result = await placeOrder({
      supabase,
      input: {
        ...common,
        orderType: orderType as PaperOrderType,
        limitPrice: finitePositive(limitPrice) ? limitPrice : undefined,
        triggerPrice: finitePositive(triggerPrice) ? triggerPrice : undefined,
        trailingPercent: finitePositive(trailingPercent) ? trailingPercent : undefined,
      },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to place paper order';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
