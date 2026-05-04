import { createServiceClient } from '@/lib/supabase';

/**
 * 함수 타임아웃 등으로 collect_requests가 'pending'/'running' 상태에 영구히 박히는 케이스 방어.
 * created_at 기준 5분 이상 지난 row를 'failed'로 마크해 다음 요청이 충돌방지에 막히지 않게 한다.
 *
 * 즉시수집 API와 collectAll 내부 충돌 체크 직전에 호출.
 */
const STALE_THRESHOLD_MS = 5 * 60_000;

export async function cleanupStaleRequests(): Promise<void> {
  const supabase = createServiceClient();
  const threshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
  const { error } = await supabase
    .from('collect_requests')
    .update({
      status: 'failed',
      error_message: '함수 타임아웃 추정 — 5분 초과 stale 자동 정리',
      completed_at: new Date().toISOString(),
    })
    .in('status', ['pending', 'running'])
    .lt('created_at', threshold);

  if (error) {
    console.warn('[collect-cleanup] stale 정리 실패:', error.message);
  }
}
