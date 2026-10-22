import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.orderId !== 'string') {
      return NextResponse.json({ error: 'A valid order ID is required' }, { status: 400 });
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

    const { data: order, error: queryError } = await supabase.from('orders')
      .select('id, oco_group_id')
      .eq('id', body.orderId)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .single();
    if (queryError) throw queryError;

    const { error: cancelError } = await supabase.from('orders')
      .update({ status: 'cancelled' })
      .eq(order.oco_group_id ? 'oco_group_id' : 'id', order.oco_group_id ?? order.id)
      .eq('user_id', user.id)
      .eq('status', 'pending');
    if (cancelError) throw cancelError;

    if (order.oco_group_id) {
      const { error: groupError } = await supabase.from('oco_groups')
        .update({ status: 'cancelled', closed_at: new Date().toISOString() })
        .eq('id', order.oco_group_id)
        .eq('user_id', user.id);
      if (groupError) throw groupError;
    }
    return NextResponse.json({ cancelled: true, orderId: order.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to cancel order';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
