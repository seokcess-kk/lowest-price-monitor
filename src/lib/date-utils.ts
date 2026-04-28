/**
 * Asia/Seoul (KST, UTC+9) 기준 날짜 키.
 * 수집·표시 모두 한국 시간 도메인이므로 toISOString() 기반 UTC date를 쓰면
 * 자정 전후 9시간 분량이 전날/당일로 잘못 묶인다.
 *
 * 서머타임이 없는 KST는 고정 +540분 오프셋이라 단순 산술로 안전하다.
 */

const KST_OFFSET_MINUTES = 9 * 60;

/** 'YYYY-MM-DD' (KST) */
export function dateKeyKST(input: string | Date = new Date()): string {
  const t = typeof input === 'string' ? Date.parse(input) : input.getTime();
  const shifted = new Date(t + KST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().split('T')[0];
}

/** N일 전 'YYYY-MM-DD' (KST) */
export function daysAgoKeyKST(days: number, ref: Date = new Date()): string {
  const t = ref.getTime() - days * 24 * 60 * 60_000;
  return dateKeyKST(new Date(t));
}

/** KST 기준 오늘 자정의 UTC ISO. SQL gte 비교용 */
export function startOfDayKstISO(input: string | Date = new Date()): string {
  const key = dateKeyKST(input);
  // key는 KST 자정. UTC로는 전날 15:00:00Z
  return new Date(`${key}T00:00:00+09:00`).toISOString();
}

/** KST 기준 그 날 23:59:59.999의 UTC ISO. SQL lte 비교용 */
export function endOfDayKstISO(input: string | Date = new Date()): string {
  const key = dateKeyKST(input);
  return new Date(`${key}T23:59:59.999+09:00`).toISOString();
}
