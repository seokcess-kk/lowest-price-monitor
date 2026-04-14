import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { Product } from '@/types/database';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();

    // 현재 상태 조회
    const { data: current, error: fetchError } = await supabase
      .from('products')
      .select('is_active')
      .eq('id', id)
      .single();

    if (fetchError || !current) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
    }

    // 토글
    const { data, error } = await supabase
      .from('products')
      .update({ is_active: !current.is_active })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data as Product);
  } catch (err) {
    console.error('[api/products/:id/toggle]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
