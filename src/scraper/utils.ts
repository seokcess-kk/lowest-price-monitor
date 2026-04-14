/**
 * 가격 문자열을 숫자로 파싱한다.
 * "12,500원" -> 12500, 파싱 실패 시 null
 */
export function parsePrice(text: string): number | null {
  if (!text || typeof text !== 'string') return null;

  const cleaned = text.replace(/[^0-9]/g, '');
  if (cleaned.length === 0) return null;

  const price = parseInt(cleaned, 10);
  if (isNaN(price) || price <= 0) return null;

  return price;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 채널 간 2~5초 랜덤 딜레이 (API rate limit 완화) */
export function randomDelay(): Promise<void> {
  const ms = 2000 + Math.random() * 3000;
  return delay(ms);
}
