import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { chunkArray } from '@/lib/query-chunk';

type BulkAction = 'activate' | 'deactivate' | 'delete';

interface BulkActionBody {
  ids: string[];
  action: BulkAction;
}

/**
 * 상품 일괄 작업.
 * - activate / deactivate: is_active 토글
 * - delete: hard delete (cascade)
 *
 * ids가 수천 개면 .in() 한 방은 PostgREST URL 길이 한도로 400이 나므로
 * 100개 청크로 순차 실행한다. 청크 중간 실패 시 앞 청크는 이미 반영된 상태 —
 * affected에 실제 처리 수를 담아 반환하고 에러를 알린다.
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
    const chunks = chunkArray(body.ids, 100);
    let affected = 0;

    for (const chunk of chunks) {
      let error: { message: string } | null;
      if (body.action === 'delete') {
        ({ error } = await supabase.from('products').delete().in('id', chunk));
      } else {
        ({ error } = await supabase
          .from('products')
          .update({ is_active: body.action === 'activate' })
          .in('id', chunk));
      }
      if (error) {
        return NextResponse.json(
          { error: `${affected}개 처리 후 실패: ${error.message}`, affected },
          { status: 500 }
        );
      }
      affected += chunk.length;
    }

    return NextResponse.json({ success: true, affected });
  } catch (err) {
    console.error('[api/products/bulk-action]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
