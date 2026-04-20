import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { PriceLog } from '@/types/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('product_id');
    const channel = searchParams.get('channel');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const limit = searchParams.get('limit');

    if (!productId) {
      return NextResponse.json({ error: 'product_id는 필수입니다.' }, { status: 400 });
    }

    const includeSuspicious = searchParams.get('include_suspicious') === 'true';

    const supabase = createServiceClient();
    let query = supabase
      .from('price_logs')
      .select('*')
      .eq('product_id', productId)
      .order('collected_at', { ascending: false });

    if (!includeSuspicious) {
      query = query.eq('is_suspicious', false);
    }
    if (channel) {
      query = query.eq('channel', channel);
    }
    if (startDate) {
      query = query.gte('collected_at', startDate);
    }
    if (endDate) {
      query = query.lte('collected_at', endDate + 'T23:59:59.999Z');
    }
    if (limit) {
      query = query.limit(parseInt(limit, 10));
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data as PriceLog[]);
  } catch (err) {
    console.error('[api/prices]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
