import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const productIdsParam = searchParams.get('product_ids');
    const brandIdsParam = searchParams.get('brand_ids');
    const mode = searchParams.get('mode') === 'daily' ? 'daily' : 'raw';
    const includeSuspicious = searchParams.get('include_suspicious') === 'true';

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'start_date와 end_date는 필수입니다.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // brand 필터는 products 테이블 기준이라 nested select inner-filter가 필요 → 사전 조회로 product_id 좁힘
    let resolvedProductIds: string[] | null = null;
    if (brandIdsParam) {
      const ids = brandIdsParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length > 0) {
        const { data: filteredProducts, error: pErr } = await supabase
          .from('products')
          .select('id')
          .in('brand_id', ids);
        if (pErr) {
          return NextResponse.json({ error: pErr.message }, { status: 500 });
        }
        resolvedProductIds = (filteredProducts ?? []).map((p) => p.id as string);
        if (resolvedProductIds.length === 0) {
          return NextResponse.json([]);
        }
      }
    }

    let query = supabase
      .from('price_logs')
      .select('*, products(name, sabangnet_code, brand:brands(name))')
      .gte('collected_at', startDate)
      .lte('collected_at', endDate + 'T23:59:59.999Z')
      .order('collected_at', { ascending: true });

    if (!includeSuspicious) {
      query = query.eq('is_suspicious', false);
    }
    if (productIdsParam) {
      const productIds = productIdsParam.split(',').map((id) => id.trim());
      query = query.in('product_id', productIds);
    } else if (resolvedProductIds) {
      query = query.in('product_id', resolvedProductIds);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data || []).map((row: Record<string, unknown>) => {
      const products = row.products as
        | { name: string; sabangnet_code: string | null; brand: { name: string } | null }
        | null;
      return {
        date: (row.collected_at as string).split('T')[0],
        productName: products?.name || '',
        sabangnetCode: products?.sabangnet_code ?? null,
        brandName: products?.brand?.name ?? null,
        channel: row.channel as string,
        price: row.price as number,
        storeName: (row.store_name as string) || null,
      };
    });

    if (mode === 'daily') {
      // 일별 × 상품 × 채널 최저가로 집계
      const map = new Map<string, typeof rows[number]>();
      for (const r of rows) {
        const key = `${r.date}|${r.productName}|${r.channel}`;
        const prev = map.get(key);
        if (!prev || r.price < prev.price) {
          map.set(key, r);
        }
      }
      const aggregated = Array.from(map.values()).sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.productName !== b.productName) return a.productName.localeCompare(b.productName);
        return a.channel.localeCompare(b.channel);
      });
      return NextResponse.json(aggregated);
    }

    return NextResponse.json(rows);
  } catch (err) {
    console.error('[api/export]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
