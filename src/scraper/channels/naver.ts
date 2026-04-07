import type { Page } from 'playwright';
import { parsePrice, PAGE_LOAD_TIMEOUT } from '../utils';

export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/**
 * 네이버 쇼핑 가격비교 페이지에서 최저가를 수집한다.
 *
 * 우선순위:
 * 1. 네이버 쇼핑 검색 API (빠르고 안정적)
 * 2. Playwright 폴백 (API 실패 시)
 */
export async function scrapeNaver(
  url: string,
  page: Page,
  productName?: string
): Promise<ScrapeResult | null> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  // 방법 1: API 우선 (키가 있고 상품명이 있을 때)
  if (clientId && clientSecret && productName) {
    const apiResult = await trySearchApi(productName, clientId, clientSecret);
    if (apiResult) {
      console.log('[naver] API로 가격 수집 완료');
      return apiResult;
    }
    console.warn('[naver] API 실패 — Playwright 폴백 시도');
  }

  // 방법 2: Playwright 폴백
  const directResult = await tryPlaywright(url, page);
  if (directResult) return directResult;

  throw new Error('네이버 쇼핑 접근 실패 - API/Playwright 모두 실패');
}

/** 네이버 쇼핑 검색 API (상품명 기반, 최저가순 정렬) */
async function trySearchApi(
  productName: string,
  clientId: string,
  clientSecret: string,
): Promise<ScrapeResult | null> {
  try {
    const apiUrl = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(productName)}&display=5&sort=asc&exclude=used`;

    const res = await fetch(apiUrl, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.items || data.items.length === 0) return null;

    const item = data.items[0];
    const price = parseInt(item.lprice, 10);
    if (!price || price <= 0) return null;

    return {
      price,
      storeName: item.mallName || null,
    };
  } catch {
    return null;
  }
}

/** Playwright로 카탈로그 페이지 직접 접근 */
async function tryPlaywright(url: string, page: Page): Promise<ScrapeResult | null> {
  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: PAGE_LOAD_TIMEOUT,
    });
    await page.waitForTimeout(5000);

    // 차단 페이지 감지
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (bodyText.includes('접속이 일시적으로 제한')) {
      console.warn('[naver] Playwright 접속 제한 감지');
      return null;
    }

    // 가격 추출 시도 — 네이버 SPA 클래스 (변동 잦음)
    let price: number | null = null;
    let storeName: string | null = null;

    // 텍스트에서 최저가 패턴 추출
    const priceData = await page.evaluate(() => {
      const body = document.body.innerText;

      // "최저 XX,XXX원" 패턴
      const lowestMatch = body.match(/최저\s*(\d{1,3}(,\d{3})+)\s*원/);
      if (lowestMatch) {
        return { priceText: lowestMatch[1] + '원', storeName: null };
      }

      // 가격비교 영역의 첫 번째 가격
      const priceMatches = body.match(/(\d{1,3}(,\d{3})+)\s*원/g);
      if (priceMatches && priceMatches.length > 0) {
        return { priceText: priceMatches[0], storeName: null };
      }

      return null;
    });

    if (priceData) {
      price = parsePrice(priceData.priceText);
      storeName = priceData.storeName;
    }

    // 셀렉터 기반 추출 시도
    if (price === null) {
      const selectors = [
        '[class*="lowestPrice"] [class*="num"]',
        '[class*="price_area"] [class*="price"]',
        '[class*="lowest"] [class*="price"]',
      ];

      for (const sel of selectors) {
        try {
          const el = await page.$(sel);
          if (!el) continue;
          const text = await el.textContent();
          if (!text) continue;
          price = parsePrice(text);
          if (price !== null) break;
        } catch {
          continue;
        }
      }
    }

    if (price === null) return null;

    // 스토어명 추출
    if (!storeName) {
      const storeSelectors = [
        '[class*="mall_name"]',
        '[class*="store"]',
        '[class*="seller"]',
      ];
      for (const sel of storeSelectors) {
        try {
          const el = await page.$(sel);
          if (!el) continue;
          const text = await el.textContent();
          if (text?.trim()) {
            storeName = text.trim();
            break;
          }
        } catch {
          continue;
        }
      }
    }

    return { price, storeName };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[naver] Playwright 실패: ${msg}`);
    return null;
  }
}
