import { chromium, type Browser, type BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';

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
 * Playwright 브라우저를 생성한다.
 * - channel: 'chrome' → 설치된 실제 Chrome 사용 (핑거프린트 정상화)
 * - AutomationControlled 플래그 비활성화 → navigator.webdriver 탐지 우회
 */
export async function createBrowser(): Promise<Browser> {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
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

/** 쿠팡 전용 프로필 경로 */
const COUPANG_PROFILE_DIR = path.resolve(process.cwd(), '.chrome-profile-coupang');

/**
 * 쿠팡 전용 Playwright persistent context를 생성한다.
 *
 * 필수조건:
 * - headless: false (쿠팡 봇 감지 우회)
 * - channel: 'chrome' (실제 Chrome 사용)
 * - persistent context (브라우저 프로필/쿠키 유지)
 * - 로컬 환경에서만 동작 (GitHub Actions 불가)
 */
export async function createCoupangBrowser(): Promise<BrowserContext> {
  if (!fs.existsSync(COUPANG_PROFILE_DIR)) {
    fs.mkdirSync(COUPANG_PROFILE_DIR, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(COUPANG_PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--disable-extensions',
    ],
    viewport: { width: 1280, height: 800 },
    locale: 'ko-KR',
  });

  return context;
}
