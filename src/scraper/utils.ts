import { chromium, type Browser } from 'playwright';

/**
 * 가격 문자열을 숫자로 파싱한다.
 * "12,500원" -> 12500, 파싱 실패 시 null
 */
export function parsePrice(text: string): number | null {
  if (!text || typeof text !== 'string') return null;

  // 숫자와 콤마만 추출
  const cleaned = text.replace(/[^0-9]/g, '');
  if (cleaned.length === 0) return null;

  const price = parseInt(cleaned, 10);
  if (isNaN(price) || price <= 0) return null;

  return price;
}

/**
 * 지정된 밀리초만큼 대기한다. (안티봇 대응)
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 2~5초 사이 랜덤 딜레이
 */
export function randomDelay(): Promise<void> {
  const ms = 2000 + Math.random() * 3000;
  return delay(ms);
}

/** User-Agent 상수 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Playwright chromium 헤드리스 브라우저를 생성한다.
 */
export async function createBrowser(): Promise<Browser> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  return browser;
}

/**
 * 브라우저 컨텍스트 생성 시 사용할 기본 옵션
 */
export const BROWSER_CONTEXT_OPTIONS = {
  userAgent: USER_AGENT,
  viewport: { width: 1920, height: 1080 },
  locale: 'ko-KR',
} as const;

/** 페이지 로드 타임아웃 (ms) */
export const PAGE_LOAD_TIMEOUT = 30_000;

/** 요소 대기 타임아웃 (ms) */
export const ELEMENT_WAIT_TIMEOUT = 10_000;
