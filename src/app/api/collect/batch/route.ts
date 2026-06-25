import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// 배치는 GitHub Actions로 dispatch만 하므로 짧게. dispatch 지연 대비 60초.
export const maxDuration = 60;

// 한 번에 보낼 수 있는 product 개수 상한 (악의적/실수성 거대 payload 방어).
const MAX_BATCH = 1000;

/**
 * 필터된 다수 상품 일괄 수집 요청.
 *
 * 전역 수집과 같은 product_id IS NULL 레인을 쓰되 product_ids 를 채워 "배치"로 구분한다.
 * 1. product_ids 검증/중복제거
 * 2. 진행 중인 전역/배치 수집이 있으면 거절 (단일 상품 수집과는 별도 레인)
 * 3. collect_requests 에 pending row 생성 (product_ids + progress_total)
 * 4. GitHub Actions workflow_dispatch (inputs.request_id) — CI의 collect.ts 가 row의 product_ids 를 읽어 수집
 */
export async function POST(req: NextRequest) {
  try {
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
    }

    const rawIds = (body as { productIds?: unknown })?.productIds;
    if (!Array.isArray(rawIds)) {
      return NextResponse.json({ error: 'productIds 배열이 필요합니다.' }, { status: 400 });
    }
    // 중복 제거 + 문자열만 + 공백 제거
    const productIds = Array.from(
      new Set(rawIds.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))
    );
    if (productIds.length === 0) {
      return NextResponse.json({ error: '수집할 상품이 없습니다.' }, { status: 400 });
    }
    if (productIds.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `한 번에 최대 ${MAX_BATCH}개까지 수집할 수 있습니다. (요청 ${productIds.length}개)` },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 진행 중 전역/배치 요청 중복 차단 (product_id IS NULL 레인)
    const { data: existing } = await supabase
      .from('collect_requests')
      .select('id, status')
      .is('product_id', null)
      .in('status', ['pending', 'running'])
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { message: '이미 수집이 진행 중입니다.', status: existing[0].status },
        { status: 200 }
      );
    }

    // Rate limit: 최근 60초 내 전역/배치 요청이 있으면 거절
    const sixtySecAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: recent } = await supabase
      .from('collect_requests')
      .select('id')
      .is('product_id', null)
      .gte('created_at', sixtySecAgo)
      .limit(1);

    if (recent && recent.length > 0) {
      return NextResponse.json(
        { error: '직전 수집 요청 후 1분이 지나지 않았습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429 }
      );
    }

    // 큐 row 생성 (배치: product_id NULL + product_ids 채움)
    const { data: created, error: insertError } = await supabase
      .from('collect_requests')
      .insert({
        status: 'pending',
        product_ids: productIds,
        progress_total: productIds.length,
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
          inputs: { request_id: String(created.id) },
        }),
      }
    );

    if (!ghRes.ok) {
      const errorText = await ghRes.text().catch(() => '');
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
      message: `${productIds.length}개 상품 수집이 트리거되었습니다.`,
      requestId: created.id,
      count: productIds.length,
    });
  } catch (err) {
    console.error('[api/collect/batch POST]', err);
    return NextResponse.json(
      { error: '수집 요청 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
