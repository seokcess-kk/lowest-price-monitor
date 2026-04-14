import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { Product, UpdateProductInput } from '@/types/database';

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
    console.error('[api/products/:id]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
