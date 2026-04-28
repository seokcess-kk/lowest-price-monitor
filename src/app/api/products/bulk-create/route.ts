import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { normalizeBrand } from '@/lib/brand-utils';
import type { CreateProductInput } from '@/types/database';

interface BulkCreateBody {
  items: CreateProductInput[];
  /**
   * 입력 brand_name이 기존 brands에 없을 때:
   *  - true(default): 새 brand row 생성 후 매핑
   *  - false: brand_id를 NULL로 두고 상품만 등록
   */
  createMissingBrands?: boolean;
}

/**
 * 상품 일괄 등록.
 * 입력 items는 호출 측에서 이미 중복 검사를 거친 것으로 가정.
 * URL 빈 문자열은 null로 정규화.
 *
 * 브랜드 처리:
 *  1. 모든 입력 brand_name을 정규화 키로 묶는다.
 *  2. 정규화 키가 같은 기존 brand가 있으면 그것을 매핑.
 *  3. 신규 키는 createMissingBrands에 따라 새로 만들거나 NULL.
 */
export async function POST(request: NextRequest) {
  try {
    const body: BulkCreateBody = await request.json();
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: 'items 배열이 필요합니다.' }, { status: 400 });
    }

    const createMissingBrands = body.createMissingBrands !== false;
    const supabase = createServiceClient();

    const validItems = body.items.filter((it) => it.name && it.name.trim() !== '');
    if (validItems.length === 0) {
      return NextResponse.json({ error: '등록할 유효한 상품이 없습니다.' }, { status: 400 });
    }

    // 입력 브랜드명을 정규화 키별로 묶기
    const inputBrandKeys = new Map<string, string>(); // key -> 첫 표기
    for (const it of validItems) {
      const raw = it.brand_name?.trim();
      if (!raw) continue;
      const key = normalizeBrand(raw);
      if (!key) continue;
      if (!inputBrandKeys.has(key)) inputBrandKeys.set(key, raw);
    }

    // 기존 brands 적재
    const { data: existing } = await supabase.from('brands').select('id, name');
    const keyToId = new Map<string, string>();
    for (const b of existing ?? []) {
      keyToId.set(normalizeBrand(b.name as string), b.id as string);
    }

    // 신규 브랜드 후보 — 기존에 없는 키만
    const toInsert: Array<{ name: string }> = [];
    for (const [key, displayName] of inputBrandKeys) {
      if (!keyToId.has(key)) {
        if (createMissingBrands) toInsert.push({ name: displayName });
      }
    }

    if (toInsert.length > 0) {
      const { data: inserted, error: brandErr } = await supabase
        .from('brands')
        .insert(toInsert)
        .select('id, name');
      if (brandErr) {
        return NextResponse.json({ error: brandErr.message }, { status: 500 });
      }
      for (const b of inserted ?? []) {
        keyToId.set(normalizeBrand(b.name as string), b.id as string);
      }
    }

    const rows = validItems.map((it) => {
      const key = it.brand_name ? normalizeBrand(it.brand_name) : '';
      return {
        name: it.name.trim(),
        sabangnet_code: it.sabangnet_code?.trim() || null,
        brand_id: it.brand_id ?? (key ? keyToId.get(key) ?? null : null),
        coupang_url: it.coupang_url?.trim() || null,
        naver_url: it.naver_url?.trim() || null,
        danawa_url: it.danawa_url?.trim() || null,
      };
    });

    const { data, error } = await supabase.from('products').insert(rows).select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, created: data?.length ?? 0 });
  } catch (err) {
    console.error('[api/products/bulk-create]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
