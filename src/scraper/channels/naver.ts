import type { Page } from 'playwright';
import { parsePrice, PAGE_LOAD_TIMEOUT } from '../utils';

export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/**
 * 네이버 쇼핑 가격비교 페이지에서 최저가를 수집한다.
 *
 * 네이버 쇼핑은 SPA + 봇 차단이 강력하므로:
 * 1. 먼저 Playwright로 페이지 렌더링 시도
 * 2. 차단 시 네이버 쇼핑 검색 API로 폴백
 * 3. 실패 시 구체적 에러 메시지
 */
export async function scrapeNaver(
  url: string,
  page: Page
): Promise<ScrapeResult | null> {
  try {
    // URL에서 카탈로그 ID 추출
    const catalogId = extractCatalogId(url);

    // 방법 1: Playwright로 직접 접근
    const directResult = await tryDirectAccess(url, page);
    if (directResult) return directResult;

    // 방법 2: 네이버 쇼핑 내부 API 시도
    if (catalogId) {
      const apiResult = await tryNaverApi(catalogId, page);
      if (apiResult) return apiResult;
    }

    throw new Error('네이버 쇼핑 접근 차단됨 - IP가 일시적으로 제한되었습니다. 시간을 두고 재시도하세요');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[naver] ${url} - ${message}`);
    throw new Error(`[네이버] ${message}`);
  }
}

/** URL에서 카탈로그 ID 추출 */
function extractCatalogId(url: string): string | null {
  const match = url.match(/catalog\/(\d+)/);
  return match ? match[1] : null;
}

/** Playwright 직접 접근 */
async function tryDirectAccess(
  url: string,
  page: Page
): Promise<ScrapeResult | null> {
  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: PAGE_LOAD_TIMEOUT,
    });
    await page.waitForTimeout(5000);

    // 차단 페이지 감지
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (bodyText.includes('접속이 일시적으로 제한')) {
      console.warn('[naver] 접속 제한 감지');
      return null;
    }

    // 가격 셀렉터 시도 (네이버 SPA 클래스 — 변동이 잦음)
    const priceSelectors = [
      '[class*="lowestPrice"] [class*="num"]',
      '[class*="price_area"] [class*="price"]',
      '[class*="productList_price"]',
      '[class*="lowest"] [class*="price"]',
    ];

    for (const selector of priceSelectors) {
      try {
        const el = await page.$(selector);
        if (!el) continue;
        const text = await el.textContent();
        if (!text) continue;
        const price = parsePrice(text);
        if (price !== null) {
          // 스토어명
          let storeName: string | null = null;
          const storeSelectors = [
            '[class*="mall_name"]',
            '[class*="lowestPrice"] [class*="mall"]',
            '[class*="store"]',
          ];
          for (const ss of storeSelectors) {
            const se = await page.$(ss);
            if (se) {
              const st = await se.textContent();
              if (st?.trim()) {
                storeName = st.trim();
                break;
              }
            }
          }
          return { price, storeName };
        }
      } catch { continue; }
    }

    // 텍스트에서 가격 패턴 추출
    const priceMatches = bodyText.match(/(\d{1,3}(,\d{3})+)\s*원/g);
    if (priceMatches && priceMatches.length > 0) {
      const price = parsePrice(priceMatches[0]);
      if (price !== null) {
        return { price, storeName: null };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/** 네이버 쇼핑 내부 API 시도 */
async function tryNaverApi(
  catalogId: string,
  page: Page
): Promise<ScrapeResult | null> {
  try {
    // page.evaluate 내에서 fetch 호출 (브라우저 컨텍스트 사용)
    const result = await page.evaluate(async (catId) => {
      try {
        const res = await fetch(
          `https://search.shopping.naver.com/api/catalog/${catId}`,
          {
            headers: {
              'Accept': 'application/json',
            },
          }
        );
        if (!res.ok) return null;
        const data = await res.json();

        // API 응답 구조에서 최저가 추출
        const lowestPrice =
          data?.catalogProduct?.lowPrice ||
          data?.lowPrice ||
          data?.catalogPrice?.lowPrice;

        const mallName =
          data?.catalogProduct?.lowMallName ||
          data?.lowMallName;

        if (lowestPrice) {
          return {
            price: typeof lowestPrice === 'string' ? parseInt(lowestPrice.replace(/[^0-9]/g, ''), 10) : lowestPrice,
            storeName: mallName || null,
          };
        }
        return null;
      } catch {
        return null;
      }
    }, catalogId);

    return result;
  } catch {
    return null;
  }
}
