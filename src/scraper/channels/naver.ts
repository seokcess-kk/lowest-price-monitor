import type { Page } from 'playwright';
import { parsePrice, ELEMENT_WAIT_TIMEOUT, PAGE_LOAD_TIMEOUT } from '../utils';

/** ScrapeResult 인터페이스 */
export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/** 네이버 쇼핑 가격비교 셀렉터 (폴백 순서) */
const NAVER_PRICE_SELECTORS = [
  // 가격비교 테이블 최저가 행
  '.productList_price_area__IA4IC .productList_price__8cIWn',
  '.lowestPrice_price_area__gSYom .lowestPrice_price__swQPU',
  // 가격비교 영역
  '.priceColl_price_area__K2v4O .priceColl_price__Dab2a',
  '.price_price_area__WsAFr .price_price__dQe0a',
  // 일반 최저가 표시
  '.lowest_price .price',
  '.lowestPrice_num__A1EbS',
] as const;

/** 네이버 쇼핑 스토어명 셀렉터 (폴백 순서) */
const NAVER_STORE_SELECTORS = [
  '.productList_mall_area__rk6G3 .productList_mall_name__S65cS',
  '.lowestPrice_mall_area__LgoMx .lowestPrice_mall_name__BXORZ',
  '.priceColl_mall_area__UDShh .priceColl_mall_name__F4Sv5',
  '.price_mall_area__JpMNt .price_mall_name__PWFOK',
  '.lowest_price .mall_name',
  '.mall_name',
] as const;

/**
 * 네이버 쇼핑 가격비교 페이지에서 최저가를 수집한다.
 * - 최저가 행에서 가격 + 스토어명 추출
 */
export async function scrapeNaver(
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
    for (const selector of NAVER_PRICE_SELECTORS) {
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
      console.warn(`[naver] 가격 요소를 찾을 수 없음: ${url}`);
      return null;
    }

    // 스토어명 추출 (실패해도 가격은 반환)
    let storeName: string | null = null;
    for (const selector of NAVER_STORE_SELECTORS) {
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
    console.error(`[naver] 스크래핑 실패: ${url} - ${message}`);
    return null;
  }
}
