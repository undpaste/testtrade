import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { placeOrder } from '@/lib/orderEngine';

const assetClasses = ['crypto', 'stock', 'etf'] as const;
const sides = ['buy', 'sell'] as const;
const orderTypes = ['market', 'limit'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

    const { symbol, assetClass, side, orderType, qty, requestedPrice, reasonEntry } = body;
    const { notes, avgDailyVolume, recentVolatility, highVolatilityMode } = body;
    if (
      typeof symbol !== 'string' || !symbol.trim() ||
      typeof assetClass !== 'string' || !assetClasses.includes(assetClass as typeof assetClasses[number]) ||
      typeof side !== 'string' || !sides.includes(side as typeof sides[number]) ||
      typeof orderType !== 'string' || !orderTypes.includes(orderType as typeof orderTypes[number]) ||
      typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0 ||
      typeof requestedPrice !== 'number' || !Number.isFinite(requestedPrice) || requestedPrice <= 0 ||
      typeof reasonEntry !== 'string' || !reasonEntry.trim() ||
      typeof avgDailyVolume !== 'number' || !Number.isFinite(avgDailyVolume) || avgDailyVolume <= 0 ||
      typeof recentVolatility !== 'number' || !Number.isFinite(recentVolatility) || recentVolatility < 0 || recentVolatility > 1 ||
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

    const result = await placeOrder({
      supabase,
      input: {
        userId: user.id,
        symbol: symbol.trim(),
        assetClass: assetClass as typeof assetClasses[number],
        side: side as typeof sides[number],
        orderType: orderType as typeof orderTypes[number],
        qty,
        requestedPrice,
        reasonEntry: reasonEntry.trim(),
        notes: notes as string | undefined,
        avgDailyVolume,
        recentVolatility,
        highVolatilityMode,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to place order';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}