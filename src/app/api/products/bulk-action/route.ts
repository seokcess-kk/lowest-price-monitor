import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type BulkAction = 'activate' | 'deactivate' | 'delete';

interface BulkActionBody {
  ids: string[];
  action: BulkAction;
}

/**
 * 상품 일괄 작업.
 * - activate / deactivate: is_active 토글
 * - delete: hard delete (cascade)
 */
export async function POST(request: NextRequest) {
  try {
    const body: BulkActionBody = await request.json();
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: 'ids 배열이 필요합니다.' }, { status: 400 });
    }
    if (!['activate', 'deactivate', 'delete'].includes(body.action)) {
      return NextResponse.json({ error: 'action이 올바르지 않습니다.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    if (body.action === 'delete') {
      const { error } = await supabase.from('products').delete().in('id', body.ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, affected: body.ids.length });
    }

    const isActive = body.action === 'activate';
    const { error } = await supabase
      .from('products')
      .update({ is_active: isActive })
      .in('id', body.ids);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, affected: body.ids.length });
  } catch (err) {
    console.error('[api/products/bulk-action]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
