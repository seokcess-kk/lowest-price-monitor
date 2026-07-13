import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { normalizeBrand } from '@/lib/brand-utils';
import {
  applyProductFilters,
  applyProductSort,
  parseProductListFilters,
  resolveSearchBrandIds,
} from '@/lib/products-query';
import type {
  Product,
  ProductFacets,
  ProductListResponse,
  CreateProductInput,
} from '@/types/database';

type ProductRowWithBrand = {
  id: string;
  name: string;
  sabangnet_code: string | null;
  brand_id: string | null;
  coupang_url: string | null;
  naver_url: string | null;
  danawa_url: string | null;
  created_at: string;
  is_active: boolean;
  brand: { id: string; name: string } | null;
};

function mapProduct(row: ProductRowWithBrand): Product {
  return {
    id: row.id,
    name: row.name,
    sabangnet_code: row.sabangnet_code,
    brand_id: row.brand_id,
    brand_name: row.brand?.name ?? null,
    coupang_url: row.coupang_url,
    naver_url: row.naver_url,
    danawa_url: row.danawa_url,
    created_at: row.created_at,
    is_active: row.is_active,
  };
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * 상품 목록 — 서버 페이지네이션 + 서버 검색/필터/정렬.
 *
 * 이전 버전은 전체 select라 Supabase 기본 행 상한(1,000)에서 조용히 잘려
 * 상품 1,000개 초과 시 오래된 상품이 목록에서 "사라지는" 문제가 있었다.
 *
 * Query: page(1-base) / page_size(≤100) / q / status / brand_ids(__none__ 지원) /
 *        ops / sort / dir / include_facets
 * 응답: ProductListResponse (src/types/database.ts)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filters = parseProductListFilters(searchParams);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get('page_size') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
    );
    const includeFacets = searchParams.get('include_facets') === 'true';

    const supabase = createServiceClient();
    const searchBrandIds = await resolveSearchBrandIds(supabase, filters.q);

    let query = supabase
      .from('products')
      .select('*, brand:brands(id, name)', { count: 'exact' });
    query = applyProductFilters(query, filters, searchBrandIds);
    query = applyProductSort(query, filters);

    const from = (page - 1) * pageSize;
    const { data, count, error } = await query.range(from, from + pageSize - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let facets: ProductFacets | undefined;
    if (includeFacets) {
      const { data: facetsData, error: facetsError } = await supabase.rpc('products_facets');
      if (facetsError) {
        console.warn(`[api/products GET] facets 조회 실패 (생략): ${facetsError.message}`);
      } else if (facetsData) {
        facets = facetsData as ProductFacets;
      }
    }

    const rows = (data ?? []) as ProductRowWithBrand[];
    const response: ProductListResponse = {
      items: rows.map(mapProduct),
      total: count ?? rows.length,
      page,
      page_size: pageSize,
      ...(facets ? { facets } : {}),
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[api/products GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * brand_name이 들어오면 정규화 키로 기존 brand를 매칭하고,
 * 없으면 새로 만든 뒤 brand_id를 채워 저장한다.
 * brand_id가 직접 들어오면 그대로 사용 (UI selector에서 기존 항목 선택 시).
 */
async function resolveBrandId(
  supabase: ReturnType<typeof createServiceClient>,
  input: { brand_name?: string | null; brand_id?: string | null }
): Promise<string | null> {
  if (input.brand_id) return input.brand_id;
  const name = input.brand_name?.trim();
  if (!name) return null;

  const key = normalizeBrand(name);
  const { data: existing } = await supabase.from('brands').select('id, name');
  const hit = (existing ?? []).find((b) => normalizeBrand(b.name as string) === key);
  if (hit) return hit.id as string;

  const { data: created, error } = await supabase
    .from('brands')
    .insert({ name })
    .select('id')
    .single();
  if (error || !created) throw new Error(error?.message ?? '브랜드 생성 실패');
  return created.id as string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateProductInput = await request.json();

    if (!body.name || body.name.trim() === '') {
      return NextResponse.json({ error: '상품명은 필수입니다.' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const brandId = await resolveBrandId(supabase, body);

    const { data, error } = await supabase
      .from('products')
      .insert({
        name: body.name.trim(),
        sabangnet_code: body.sabangnet_code?.trim() || null,
        brand_id: brandId,
        coupang_url: body.coupang_url || null,
        naver_url: body.naver_url || null,
        danawa_url: body.danawa_url || null,
      })
      .select('*, brand:brands(id, name)')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(mapProduct(data as ProductRowWithBrand), { status: 201 });
  } catch (err) {
    console.error('[api/products POST]', err);
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
