import { createServiceClient } from '@/lib/supabase';

/**
 * 함수 타임아웃·job 강제 종료 등으로 collect_requests가 'pending'/'running' 상태에
 * 영구히 박히는 케이스 방어. 즉시수집 API와 collectAll 내부 충돌 체크 직전에 호출.
 *
 * 판정 기준 (created_at 일괄 5분 룰 금지 — 전역 수집은 수 시간짜리 정상 실행이라
 * 그 룰이 진행 중인 수집을 오살하고 중복 수집까지 허용했다):
 *   - pending: 생성 후 15분 내에 워크플로우가 집어가지 않으면 dispatch 유실로 간주
 *   - running: heartbeat(last_progress_at, 상품 1개 처리마다 갱신)가 30분 끊기면 사망으로 간주
 */
const PENDING_STALE_MS = 15 * 60_000;
const RUNNING_STALE_MS = 30 * 60_000;

export async function cleanupStaleRequests(): Promise<void> {
  const supabase = createServiceClient();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const pendingThreshold = new Date(now - PENDING_STALE_MS).toISOString();
  const runningThreshold = new Date(now - RUNNING_STALE_MS).toISOString();

  const { error: pendingError } = await supabase
    .from('collect_requests')
    .update({
      status: 'failed',
      error_message: '워크플로우 미시작 추정 — pending 15분 초과 stale 자동 정리',
      completed_at: nowIso,
    })
    .eq('status', 'pending')
    .lt('created_at', pendingThreshold);

  if (pendingError) {
    console.warn('[collect-cleanup] pending stale 정리 실패:', pendingError.message);
  }

  // heartbeat 우선, 없으면 started_at, 그것도 없으면 created_at 기준 (COALESCE 등가)
  const { error: runningError } = await supabase
    .from('collect_requests')
    .update({
      status: 'failed',
      error_message: '실행 중단 추정 — heartbeat 30분 초과 stale 자동 정리',
      completed_at: nowIso,
    })
    .eq('status', 'running')
    .or(
      `last_progress_at.lt.${runningThreshold},` +
        `and(last_progress_at.is.null,started_at.lt.${runningThreshold}),` +
        `and(last_progress_at.is.null,started_at.is.null,created_at.lt.${runningThreshold})`
    );

  if (runningError) {
    // 016 마이그레이션(last_progress_at) 미적용 환경에서는 이 쿼리가 실패한다 — 정리 없이 통과
    console.warn('[collect-cleanup] running stale 정리 실패:', runningError.message);
  }
}
