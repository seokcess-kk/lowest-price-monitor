import type { Page } from 'playwright';
import { parsePrice, ELEMENT_WAIT_TIMEOUT, PAGE_LOAD_TIMEOUT } from '../utils';

export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/**
 * 쿠팡 상품 페이지에서 가격을 수집한다.
 * - store_name은 항상 null (쿠팡 직접 판매)
 * - 쿠팡은 봇 차단이 강력하므로, 차단 시 구체적 에러 메시지를 반환
 */
export async function scrapeCoupang(
  url: string,
  page: Page
): Promise<ScrapeResult | null> {
  try {
    // webdriver 탐지 우회
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // @ts-ignore
      window.chrome = { runtime: {} };
    });

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_LOAD_TIMEOUT,
    });

    // HTTP 상태 코드 확인
    const status = response?.status();
    if (status === 403 || status === 401) {
      throw new Error(`쿠팡 접근 차단 (HTTP ${status}) - IP가 차단되었을 수 있습니다`);
    }

    // Access Denied 페이지 감지
    const title = await page.title();
    if (title.includes('Access Denied')) {
      throw new Error('쿠팡 Access Denied - IP 차단됨. 다른 네트워크에서 시도하거나 시간을 두고 재시도하세요');
    }

    // 가격 요소 대기
    await page.waitForTimeout(2000);

    // 가격 셀렉터 시도
    const priceSelectors = [
      '.prod-sale-price .total-price strong',
      '.prod-buy-header .total-price strong',
      '.prod-price .total-price strong',
      '.prod-coupon-price .total-price',
      '.total-price strong',
      '.prod-sale-price',
    ];

    for (const selector of priceSelectors) {
      try {
        const element = await page.waitForSelector(selector, {
          timeout: ELEMENT_WAIT_TIMEOUT,
        });
        if (!element) continue;

        const text = await element.textContent();
        if (!text) continue;

        const price = parsePrice(text);
        if (price !== null) {
          return { price, storeName: null };
        }
      } catch {
        continue;
      }
    }

    // 셀렉터로 못 찾은 경우 페이지 텍스트에서 가격 패턴 시도
    const bodyText = await page.evaluate(() => document.body.innerText);
    const priceMatch = bodyText.match(/(\d{1,3}(,\d{3})+)\s*원/);
    if (priceMatch) {
      const price = parsePrice(priceMatch[0]);
      if (price !== null) {
        return { price, storeName: null };
      }
    }

    throw new Error(`가격 요소를 찾을 수 없음 (페이지 타이틀: ${title})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[coupang] ${url} - ${message}`);
    throw new Error(`[쿠팡] ${message}`);
  }
}
