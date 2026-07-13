import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { selectAllRange } from '@/lib/query-chunk';
import {
  applyProductFilters,
  applyProductSort,
  parseProductListFilters,
  resolveSearchBrandIds,
} from '@/lib/products-query';
import type { ProductIdsResponse } from '@/types/database';

/**
 * 필터 결과 전체의 상품 id만 반환 — "필터 결과 N개 모두 선택", "활성 상품만 선택",
 * "필터된 상품 일괄 수집"용. row 전체를 나르지 않으므로 5,000개여도 ~190KB.
 *
 * 필터 파라미터는 GET /api/products 와 동일 (src/lib/products-query.ts 공유) —
 * 화면에 보이는 필터 결과와 여기 ids가 반드시 일치해야 한다.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filters = parseProductListFilters(searchParams);

    const supabase = createServiceClient();
    const searchBrandIds = await resolveSearchBrandIds(supabase, filters.q);

    const rows = await selectAllRange<{ id: string }>((from, to) => {
      let query = supabase.from('products').select('id');
      query = applyProductFilters(query, filters, searchBrandIds);
      query = applyProductSort(query, filters);
      return query.range(from, to);
    });

    const response: ProductIdsResponse = {
      ids: rows.map((r) => r.id),
      total: rows.length,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[api/products/ids GET]', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
