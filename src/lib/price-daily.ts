import type { createServiceClient } from './supabase';

/**
 * refresh_price_daily RPC를 날짜 청크로 나눠 순차 호출.
 *
 * 긴 범위(30일+)를 한 방에 호출하면 PostgREST statement timeout(기본 8초)에 걸린다 —
 * 윈도우 함수 + 수만 행 upsert가 한 statement라서. SQL Editor로 돌린 백필은 타임아웃이
 * 없어 통과하지만, 서버/CI 경유 호출은 반드시 이 헬퍼를 쓸 것.
 *
 * 청크 기본 3일 ≈ 상품 5,000개 기준 upsert ~1.1만 행 — 타임아웃 여유.
 */
const DEFAULT_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function addDaysKey(dateKey: string, days: number): string {
  const t = new Date(`${dateKey}T00:00:00Z`).getTime() + days * DAY_MS;
  return new Date(t).toISOString().split('T')[0];
}

export interface RefreshRangeResult {
  /** upsert/삭제된 요약 행 수 합계 */
  refreshed: number;
  /** 청크별 실패 메시지 (빈 배열이면 전체 성공) */
  errors: string[];
}

export async function refreshPriceDailyRange(
  supabase: ReturnType<typeof createServiceClient>,
  fromKey: string,
  toKey: string,
  options?: { productIds?: string[]; windowDays?: number }
): Promise<RefreshRangeResult> {
  const windowDays = Math.max(1, options?.windowDays ?? DEFAULT_WINDOW_DAYS);
  let refreshed = 0;
  const errors: string[] = [];

  for (let start = fromKey; start <= toKey; start = addDaysKey(start, windowDays)) {
    const end = (() => {
      const candidate = addDaysKey(start, windowDays - 1);
      return candidate < toKey ? candidate : toKey;
    })();
    const { data, error } = await supabase.rpc('refresh_price_daily', {
      p_from: start,
      p_to: end,
      ...(options?.productIds ? { p_product_ids: options.productIds } : {}),
    });
    if (error) {
      errors.push(`[${start}~${end}] ${error.message}`);
    } else if (typeof data === 'number') {
      refreshed += data;
    }
  }

  return { refreshed, errors };
}
