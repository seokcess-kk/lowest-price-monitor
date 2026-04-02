import type { Page } from 'playwright';
import { parsePrice, ELEMENT_WAIT_TIMEOUT, PAGE_LOAD_TIMEOUT } from '../utils';

/** ScrapeResult 인터페이스 */
export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/** 쿠팡 가격 셀렉터 (폴백 순서) */
const COUPANG_PRICE_SELECTORS = [
  '.prod-sale-price .total-price strong',
  '.prod-buy-header .total-price strong',
  '.prod-price .total-price strong',
  '.prod-coupon-price .total-price',
  '.total-price strong',
  '.prod-sale-price',
] as const;

/**
 * 쿠팡 상품 페이지에서 가격을 수집한다.
 * - 쿠팡은 직접 판매이므로 store_name은 항상 null
 * - 여러 셀렉터를 폴백 방식으로 시도
 */
export async function scrapeCoupang(
  url: string,
  page: Page
): Promise<ScrapeResult | null> {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_LOAD_TIMEOUT,
    });

    // 가격 요소가 렌더링될 때까지 대기
    for (const selector of COUPANG_PRICE_SELECTORS) {
      try {
        const element = await page.waitForSelector(selector, {
          timeout: ELEMENT_WAIT_TIMEOUT,
        });

        if (element) {
          const text = await element.textContent();
          if (text) {
            const price = parsePrice(text);
            if (price !== null) {
              return { price, storeName: null };
            }
          }
        }
      } catch {
        // 이 셀렉터에서 찾지 못함 -> 다음 셀렉터 시도
        continue;
      }
    }

    console.warn(`[coupang] 가격 요소를 찾을 수 없음: ${url}`);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[coupang] 스크래핑 실패: ${url} - ${message}`);
    return null;
  }
}
