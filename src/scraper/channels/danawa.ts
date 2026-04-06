import type { Page } from 'playwright';
import { parsePrice, ELEMENT_WAIT_TIMEOUT, PAGE_LOAD_TIMEOUT } from '../utils';

export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/**
 * 다나와 가격비교 페이지에서 최저가를 수집한다.
 *
 * 가격비교 리스트 첫 번째 행에서 가격과 판매처를 함께 추출한다.
 * 리스트가 없으면 상단 최저가 영역에서 폴백.
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

    // 가격비교 영역이 동적 로드되므로 대기
    await page.waitForTimeout(3000);

    // 방법 1: 가격비교 리스트 첫 번째 행 (가격 + 스토어 정확히 매칭)
    const listPrice = await extractListPrice(page);
    if (listPrice) return listPrice;

    // 방법 2: 상단 최저가 영역 폴백
    const topPrice = await extractTopPrice(page);
    if (topPrice) return topPrice;

    // 페이지 상태 진단
    const diagnosis = await page.evaluate(() => {
      const title = document.title;
      const body = document.body.innerText.substring(0, 200);
      const hasDiffItem = !!document.querySelector('.diff_item');
      const hasSellPrice = !!document.querySelector('.sell-price');
      return { title, body, hasDiffItem, hasSellPrice };
    });

    console.warn(`[danawa] 가격 추출 실패 - 진단: ${JSON.stringify(diagnosis)}`);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[danawa] 스크래핑 실패: ${url} - ${message}`);
    return null;
  }
}

/** 가격비교 리스트 첫 번째 행에서 가격 + 스토어명 추출 */
async function extractListPrice(page: Page): Promise<ScrapeResult | null> {
  try {
    const firstItem = await page.$('.diff_item:first-child');
    if (!firstItem) return null;

    // 가격
    const priceEl = await firstItem.$('.prc_c');
    if (!priceEl) return null;

    const priceText = await priceEl.textContent();
    if (!priceText) return null;

    const price = parsePrice(priceText);
    if (price === null) return null;

    // 스토어명 (이미지 alt에서 추출)
    let storeName: string | null = null;
    try {
      const mallImg = await firstItem.$('.logo_over img, .d_mall img');
      if (mallImg) {
        storeName = await mallImg.getAttribute('alt');
      }
    } catch { /* 무시 */ }

    return { price, storeName };
  } catch {
    return null;
  }
}

/** 상단 최저가 영역에서 가격 추출 (스토어 정보 없음) */
async function extractTopPrice(page: Page): Promise<ScrapeResult | null> {
  const selectors = ['a.link__sell-price', 'div.sell-price'];

  for (const selector of selectors) {
    try {
      const el = await page.waitForSelector(selector, { timeout: ELEMENT_WAIT_TIMEOUT });
      if (!el) continue;

      const text = await el.textContent();
      if (!text) continue;

      const price = parsePrice(text);
      if (price === null) continue;

      return { price, storeName: null };
    } catch {
      continue;
    }
  }

  return null;
}
