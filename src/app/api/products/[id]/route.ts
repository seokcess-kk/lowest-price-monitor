import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { Product, UpdateProductInput } from '@/types/database';

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
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json(data as Product);
  } catch (err) {
    console.error('[api/products/:id GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
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
    if (body.coupang_url !== undefined) updateData.coupang_url = body.coupang_url;
    if (body.naver_url !== undefined) updateData.naver_url = body.naver_url;
    if (body.danawa_url !== undefined) updateData.danawa_url = body.danawa_url;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json(data as Product);
  } catch (err) {
    console.error('[api/products/:id PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
