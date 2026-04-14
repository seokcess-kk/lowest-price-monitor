import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * 즉시 수집 요청.
 *
 * 1. collect_requests 큐에 pending row 생성
 * 2. GitHub Actions workflow_dispatch 호출 (inputs.request_id로 row id 전달)
 * 3. GitHub Actions가 시작/완료 시 같은 row의 status를 업데이트
 *
 * 동시에 진행 중인 수집이 있으면 거절.
 */
export async function POST() {
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

    const supabase = createServiceClient();

    // 진행 중 요청 중복 차단
    const { data: existing } = await supabase
      .from('collect_requests')
      .select('id, status')
      .in('status', ['pending', 'running'])
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { message: '이미 수집이 진행 중입니다.', status: existing[0].status },
        { status: 200 }
      );
    }

    // Rate limit: 최근 60초 내에 새로 생성된 요청이 있으면 거절
    // (완료된 것도 포함 — 너무 잦은 연속 트리거 방지)
    const sixtySecAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: recent } = await supabase
      .from('collect_requests')
      .select('id, created_at')
      .gte('created_at', sixtySecAgo)
      .limit(1);

    if (recent && recent.length > 0) {
      return NextResponse.json(
        {
          error:
            '직전 수집 요청 후 1분이 지나지 않았습니다. 잠시 후 다시 시도해주세요.',
        },
        { status: 429 }
      );
    }

    // 큐 row 생성
    const { data: created, error: insertError } = await supabase
      .from('collect_requests')
      .insert({ status: 'pending' })
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
      message: '수집이 트리거되었습니다.',
      requestId: created.id,
    });
  } catch (err) {
    console.error('[api/collect POST]', err);
    return NextResponse.json(
      { error: '수집 요청 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

/** 가장 최근 수집 요청의 상태를 반환 (대시보드 폴링용) */
export async function GET() {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('collect_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return NextResponse.json({ status: 'idle' });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ status: 'idle' });
  }
}
