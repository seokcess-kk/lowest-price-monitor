import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);

    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const productId = searchParams.get('product_id');

    let query = supabase
      .from('scrape_errors')
      .select('*, products(name)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (productId) {
      query = query.eq('product_id', productId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id,
      product_id: row.product_id,
      product_name: (row.products as Record<string, unknown>)?.name ?? '알 수 없음',
      channel: row.channel,
      error_message: row.error_message,
      created_at: row.created_at,
    }));

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
