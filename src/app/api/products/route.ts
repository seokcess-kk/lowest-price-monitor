import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { normalizeBrand } from '@/lib/brand-utils';
import type { Product, CreateProductInput } from '@/types/database';

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active_only') !== 'false';
    const brandIdsParam = searchParams.get('brand_ids');

    const supabase = createServiceClient();
    let query = supabase
      .from('products')
      .select('*, brand:brands(id, name)')
      .order('created_at', { ascending: false });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }
    if (brandIdsParam) {
      const ids = brandIdsParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length > 0) {
        query = query.in('brand_id', ids);
      }
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as ProductRowWithBrand[];
    return NextResponse.json(rows.map(mapProduct));
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
