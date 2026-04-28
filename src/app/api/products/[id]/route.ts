import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { normalizeBrand } from '@/lib/brand-utils';
import type { Product, UpdateProductInput } from '@/types/database';

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

/** 단일 상품 조회 — 상세 페이지 헤더에서 사용 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('products')
      .select('*, brand:brands(id, name)')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json(mapProduct(data as ProductRowWithBrand));
  } catch (err) {
    console.error('[api/products/:id GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function resolveBrandId(
  supabase: ReturnType<typeof createServiceClient>,
  brandName: string | null
): Promise<string | null> {
  if (!brandName) return null;
  const key = normalizeBrand(brandName);
  const { data: existing } = await supabase.from('brands').select('id, name');
  const hit = (existing ?? []).find((b) => normalizeBrand(b.name as string) === key);
  if (hit) return hit.id as string;
  const { data: created, error } = await supabase
    .from('brands')
    .insert({ name: brandName })
    .select('id')
    .single();
  if (error || !created) throw new Error(error?.message ?? '브랜드 생성 실패');
  return created.id as string;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: UpdateProductInput = await request.json();

    const supabase = createServiceClient();
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.sabangnet_code !== undefined)
      updateData.sabangnet_code = body.sabangnet_code?.trim() || null;
    if (body.coupang_url !== undefined) updateData.coupang_url = body.coupang_url;
    if (body.naver_url !== undefined) updateData.naver_url = body.naver_url;
    if (body.danawa_url !== undefined) updateData.danawa_url = body.danawa_url;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    // brand_id 직접 지정 우선, 그 다음 brand_name으로 매칭/생성, null이면 해제
    if (body.brand_id !== undefined) {
      updateData.brand_id = body.brand_id;
    } else if (body.brand_name !== undefined) {
      updateData.brand_id = body.brand_name
        ? await resolveBrandId(supabase, body.brand_name.trim())
        : null;
    }

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', id)
      .select('*, brand:brands(id, name)')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json(mapProduct(data as ProductRowWithBrand));
  } catch (err) {
    console.error('[api/products/:id PUT]', err);
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * 상품 영구 삭제 (hard delete).
 * price_logs / scrape_errors는 ON DELETE CASCADE로 함께 삭제됨.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();

    const { error } = await supabase.from('products').delete().eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/products/:id DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
