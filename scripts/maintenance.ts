import { createServiceClient } from '../src/lib/supabase';
import { dateKeyKST, daysAgoKeyKST } from '../src/lib/date-utils';

/**
 * 일일 유지보수 (maintenance.yml 크론 → npm run maintenance:ci).
 *
 * 1. 일별 요약 대사(reconciliation): 최근 35일의 price_daily를 재계산.
 *    수집 직후 훅이 놓친 케이스(수동 마킹, 부분 실패 등)를 하루 1회 보정한다.
 *    35일 = mark_outliers 윈도우(30일) + 여유. ⚠ 보존 기간 밖(원본이 삭제된 과거)을
 *    범위에 넣으면 요약이 삭제되므로 절대 넓히지 말 것.
 * 2. 보존 정책(purge_old_data): 배치 단위 RPC를 done=true까지 반복 호출.
 */

const RECONCILE_DAYS = 35;
const MAX_PURGE_ITERATIONS = 100;

async function main(): Promise<void> {
  const supabase = createServiceClient();

  // 1) 요약 대사
  const { data: refreshed, error: refreshErr } = await supabase.rpc('refresh_price_daily', {
    p_from: daysAgoKeyKST(RECONCILE_DAYS),
    p_to: dateKeyKST(),
  });
  if (refreshErr) {
    console.error(`[maintenance] refresh_price_daily 실패: ${refreshErr.message}`);
    process.exit(1);
  }
  console.log(`[maintenance] 일별 요약 대사 완료 — ${refreshed ?? 0}행 upsert/삭제`);

  // 2) 보존 정책 — 배치 반복
  const totals: Record<string, number> = {};
  for (let i = 1; i <= MAX_PURGE_ITERATIONS; i++) {
    const { data, error } = await supabase.rpc('purge_old_data');
    if (error) {
      console.error(`[maintenance] purge_old_data 실패 (iteration ${i}): ${error.message}`);
      process.exit(1);
    }
    const result = (data ?? {}) as Record<string, unknown>;
    for (const key of [
      'price_logs',
      'scrape_errors',
      'collect_requests',
      'brightdata_usage_logs',
    ]) {
      const n = typeof result[key] === 'number' ? (result[key] as number) : 0;
      totals[key] = (totals[key] ?? 0) + n;
    }
    console.log(`[maintenance] purge batch ${i}: ${JSON.stringify(result)}`);
    if (result.done === true) {
      console.log(`[maintenance] 보존 정리 완료 — 누적 삭제: ${JSON.stringify(totals)}`);
      return;
    }
  }
  // 배치 한도 도달 — 다음 크론이 이어서 정리한다 (실패 아님)
  console.warn(
    `[maintenance] ${MAX_PURGE_ITERATIONS}회 배치 후에도 잔여 데이터 있음 — 다음 실행에서 계속. 누적: ${JSON.stringify(totals)}`
  );
}

main().catch((err) => {
  console.error('[maintenance] 예외:', err instanceof Error ? err.message : err);
  process.exit(1);
});
