import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { CreateProductInput } from '@/types/database';

interface BulkCreateBody {
  items: CreateProductInput[];
}

/**
 * 상품 일괄 등록.
 * 입력 items는 호출 측에서 이미 중복 검사를 거친 것으로 가정.
 * URL 빈 문자열은 null로 정규화.
 */
export async function POST(request: NextRequest) {
  try {
    const body: BulkCreateBody = await request.json();
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: 'items 배열이 필요합니다.' }, { status: 400 });
    }

    const rows = body.items
      .filter((it) => it.name && it.name.trim() !== '')
      .map((it) => ({
        name: it.name.trim(),
        sabangnet_code: it.sabangnet_code?.trim() || null,
        coupang_url: it.coupang_url?.trim() || null,
        naver_url: it.naver_url?.trim() || null,
        danawa_url: it.danawa_url?.trim() || null,
      }));

    if (rows.length === 0) {
      return NextResponse.json({ error: '등록할 유효한 상품이 없습니다.' }, { status: 400 });
    }

    const supabase = createServiceClient();
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
