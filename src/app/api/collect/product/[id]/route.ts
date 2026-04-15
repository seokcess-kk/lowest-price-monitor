import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { collectAll } from '@/scraper';

/**
 * 상품별 즉시 수집 (서버리스 인라인 실행).
 *
 * 정책:
 * - 전역 수집(product_id IS NULL)이 pending/running 이면 거절
 * - 동일 상품이 이미 pending/running 이면 거절
 * - 동일 상품 최근 60초 내 요청이 있으면 429
 * - 그 외에는 collect_requests 에 product_id row 생성 후 collectAll 인라인 실행
 * - 실행 결과에 따라 completed/failed 로 마크하고 동기 응답 반환
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: productId } = await context.params;
  if (!productId) {
    return NextResponse.json({ error: 'productId 누락' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 전역 수집 중 차단
  const { data: globalActive } = await supabase
    .from('collect_requests')
    .select('id, status')
    .is('product_id', null)
    .in('status', ['pending', 'running'])
    .limit(1);
  if (globalActive && globalActive.length > 0) {
    return NextResponse.json(
      { error: '전체 수집이 진행 중입니다. 완료 후 다시 시도해주세요.' },
      { status: 409 }
    );
  }

  // 동일 상품 중복 차단
  const { data: sameActive } = await supabase
    .from('collect_requests')
    .select('id, status')
    .eq('product_id', productId)
    .in('status', ['pending', 'running'])
    .limit(1);
  if (sameActive && sameActive.length > 0) {
    return NextResponse.json(
      { error: '해당 상품 수집이 이미 진행 중입니다.' },
      { status: 409 }
    );
  }

  // 상품 단위 rate limit (60초)
  const sixtySecAgo = new Date(Date.now() - 60_000).toISOString();
  const { data: recent } = await supabase
    .from('collect_requests')
    .select('id')
    .eq('product_id', productId)
    .gte('created_at', sixtySecAgo)
    .limit(1);
  if (recent && recent.length > 0) {
    return NextResponse.json(
      { error: '직전 수집 후 1분이 지나지 않았습니다.' },
      { status: 429 }
    );
  }

  // 큐 row (running) 생성
  const { data: created, error: insertError } = await supabase
    .from('collect_requests')
    .insert({
      status: 'running',
      product_id: productId,
      started_at: new Date().toISOString(),
      progress_total: 1,
      progress_done: 0,
    })
    .select()
    .single();
  if (insertError || !created) {
    return NextResponse.json(
      { error: insertError?.message || '큐 생성 실패' },
      { status: 500 }
    );
  }

  try {
    const summary = await collectAll({
      isManual: true,
      productIds: [productId],
    });

    await supabase
      .from('collect_requests')
      .update({
        status: 'completed',
        result_success: summary.success,
        result_failed: summary.failed,
        completed_at: new Date().toISOString(),
        progress_done: 1,
      })
      .eq('id', created.id);

    return NextResponse.json({
      message: '수집 완료',
      requestId: created.id,
      success: summary.success,
      failed: summary.failed,
      errors: summary.errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('collect_requests')
      .update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', created.id);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
