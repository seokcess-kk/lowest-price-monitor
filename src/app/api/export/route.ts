import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const productIdsParam = searchParams.get('product_ids');

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'start_date와 end_date는 필수입니다.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    let query = supabase
      .from('price_logs')
      .select('*, products(name)')
      .gte('collected_at', startDate)
      .lte('collected_at', endDate + 'T23:59:59.999Z')
      .order('collected_at', { ascending: true });

    if (productIdsParam) {
      const productIds = productIdsParam.split(',').map((id) => id.trim());
      query = query.in('product_id', productIds);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = (data || []).map((row: Record<string, unknown>) => {
      const products = row.products as { name: string } | null;
      return {
        date: (row.collected_at as string).split('T')[0],
        productName: products?.name || '',
        channel: row.channel as string,
        price: row.price as number,
        storeName: (row.store_name as string) || null,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/export]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
