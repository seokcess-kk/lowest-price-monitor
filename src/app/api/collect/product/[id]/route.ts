import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { cleanupStaleRequests } from '@/lib/collect-cleanup';

// dispatch만 하고 끝나므로 길게 잡을 필요 없음.
export const maxDuration = 60;

/**
 * 상품별 즉시 수집 (GitHub Actions dispatch 방식).
 *
 * 이전에는 Vercel 함수 안에서 collectAll을 인라인 실행했지만, Hobby plan의 60초
 * timeout 한도와 Web Unlocker 빈응답 재시도 시간(최대 ~3분)이 충돌해 함수가
 * 강제 종료되며 collect_requests가 running으로 박히는 문제가 있었다.
 *
 * 정책:
 * - 전역 수집(product_id IS NULL)이 pending/running 이면 거절
 * - 동일 상품이 이미 pending/running 이면 거절
 * - 동일 상품 최근 60초 내 요청이 있으면 429
 * - 그 외에는 collect_requests에 product_id row 생성 후 GitHub Actions를 dispatch.
 *   request_id와 product_id를 inputs로 전달.
 * - 실제 수집·상태 업데이트는 워크플로우 안의 collect.ts가 담당.
 * - 응답은 즉시 반환되고 클라이언트는 collect_requests 폴링으로 결과 확인.
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: productId } = await context.params;
  if (!productId) {
    return NextResponse.json({ error: 'productId 누락' }, { status: 400 });
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const workflowFile = process.env.GITHUB_WORKFLOW_FILE || 'collect-prices.yml';
  const ref = process.env.GITHUB_WORKFLOW_REF || 'main';

  if (!token || !repo) {
    return NextResponse.json(
      { error: 'GITHUB_TOKEN / GITHUB_REPOSITORY 환경변수가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  const supabase = createServiceClient();

  // 함수 타임아웃 등으로 영구히 running에 박힌 row가 있으면 충돌체크에 막히므로 먼저 정리
  await cleanupStaleRequests();

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

  // 큐 row 생성 (pending — workflow가 시작하면 running으로 전환)
  const { data: created, error: insertError } = await supabase
    .from('collect_requests')
    .insert({
      status: 'pending',
      product_id: productId,
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

  // GitHub Actions workflow_dispatch
  const ghRes = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref,
        inputs: {
          request_id: String(created.id),
          product_id: String(productId),
        },
      }),
    }
  );

  if (!ghRes.ok) {
    const errorText = await ghRes.text().catch(() => '');
    // 큐 row를 failed로 마크해서 폴링이 영원히 pending에 머물지 않게
    await supabase
      .from('collect_requests')
      .update({
        status: 'failed',
        error_message: `GitHub Actions 호출 실패: ${ghRes.status} ${errorText}`,
        completed_at: new Date().toISOString(),
      })
      .eq('id', created.id);

    return NextResponse.json(
      { error: `GitHub Actions 호출 실패: ${ghRes.status} ${errorText}` },
      { status: ghRes.status }
    );
  }

  return NextResponse.json({
    message: '수집이 트리거되었습니다. 결과는 1~3분 후에 반영됩니다.',
    requestId: created.id,
  });
}
