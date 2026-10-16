import { NextRequest, NextResponse } from 'next/server';
import { placeOrder } from '@/lib/orderEngine';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Get user from auth header (simplify: use service role + userId from body)
    const result = await placeOrder({
      userId: body.userId,
      symbol: body.symbol,
      assetClass: body.assetClass,
      side: body.side,
      orderType: body.orderType,
      qty: body.qty,
      requestedPrice: body.requestedPrice,
      reasonEntry: body.reasonEntry,
      notes: body.notes,
      avgDailyVolume: body.avgDailyVolume,
      recentVolatility: body.recentVolatility,
      highVolatilityMode: body.highVolatilityMode,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}