import type { Page } from 'playwright';
import { parsePrice, ELEMENT_WAIT_TIMEOUT, PAGE_LOAD_TIMEOUT } from '../utils';

/** ScrapeResult 인터페이스 */
export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/** 다나와 가격비교 가격 셀렉터 (폴백 순서) */
const DANAWA_PRICE_SELECTORS = [
  // 최저가 리스트 영역
  '.lowest_List .lowest_top .prc_c',
  '.lowest_List .row:first-child .prc_c',
  // 가격비교 테이블
  '.diff_item:first-child .prc_t',
  '.prod_pricelist .prc_c',
  // 일반 최저가 표시
  '.lowest_price .prc_c',
  '.summary_info .prc_t',
] as const;

/** 다나와 스토어명 셀렉터 (폴백 순서) */
const DANAWA_STORE_SELECTORS = [
  '.lowest_List .lowest_top .mall_name',
  '.lowest_List .row:first-child .mall_name',
  '.diff_item:first-child .mall_name',
  '.prod_pricelist .mall_name',
  '.lowest_price .mall_name',
] as const;

/**
 * 다나와 가격비교 페이지에서 최저가를 수집한다.
 * - 가격비교 테이블에서 최저가 행의 가격 + 스토어명 추출
 */
export async function scrapeDanawa(
  url: string,
  page: Page
): Promise<ScrapeResult | null> {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_LOAD_TIMEOUT,
    });

    let price: number | null = null;

    // 가격 추출
    for (const selector of DANAWA_PRICE_SELECTORS) {
      try {
        const element = await page.waitForSelector(selector, {
          timeout: ELEMENT_WAIT_TIMEOUT,
        });

        if (element) {
          const text = await element.textContent();
          if (text) {
            price = parsePrice(text);
            if (price !== null) break;
          }
        }
      } catch {
        continue;
      }
    }

    if (price === null) {
      console.warn(`[danawa] 가격 요소를 찾을 수 없음: ${url}`);
      return null;
    }

    // 스토어명 추출 (실패해도 가격은 반환)
    let storeName: string | null = null;
    for (const selector of DANAWA_STORE_SELECTORS) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && text.trim().length > 0) {
            storeName = text.trim();
            break;
          }
        }
      } catch {
        continue;
      }
    }

    return { price, storeName };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[danawa] 스크래핑 실패: ${url} - ${message}`);
    return null;
  }
}
