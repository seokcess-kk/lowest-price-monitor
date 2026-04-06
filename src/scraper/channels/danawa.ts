import type { Page } from 'playwright';
import { parsePrice, ELEMENT_WAIT_TIMEOUT, PAGE_LOAD_TIMEOUT } from '../utils';

export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/**
 * 다나와 가격비교 페이지에서 쇼핑몰별 최저가를 수집한다.
 *
 * #lowPriceCompanyArea > ul.list__mall-price > li:first-child 에서
 * 가격(.text__num)과 판매채널(img.alt)을 추출한다.
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

    // 쇼핑몰별 최저가 영역 로딩 대기
    await page.waitForSelector('#lowPriceCompanyArea .list__mall-price .list-item', {
      timeout: ELEMENT_WAIT_TIMEOUT,
    }).catch(() => {});
    await page.waitForTimeout(1000);

    // 방법 1: 쇼핑몰별 최저가 첫 번째 항목
    const mallPrice = await extractMallPrice(page);
    if (mallPrice) return mallPrice;

    // 방법 2: 기존 가격비교 리스트 폴백
    const listPrice = await extractListPrice(page);
    if (listPrice) return listPrice;

    const diagnosis = await page.evaluate(() => {
      const title = document.title;
      const hasLowPrice = !!document.querySelector('#lowPriceCompanyArea');
      const hasDiffItem = !!document.querySelector('.diff_item');
      return { title, hasLowPrice, hasDiffItem };
    });

    console.warn(`[danawa] 가격 추출 실패 - 진단: ${JSON.stringify(diagnosis)}`);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[danawa] 스크래핑 실패: ${url} - ${message}`);
    return null;
  }
}

/** #lowPriceCompanyArea의 첫 번째 쇼핑몰에서 가격 + 스토어명 추출 */
async function extractMallPrice(page: Page): Promise<ScrapeResult | null> {
  try {
    const firstItem = await page.$('#lowPriceCompanyArea .list__mall-price .list-item:first-child');
    if (!firstItem) return null;

    // 가격: .text__num
    const priceEl = await firstItem.$('.text__num');
    if (!priceEl) return null;

    const priceText = await priceEl.textContent();
    if (!priceText) return null;

    const price = parsePrice(priceText);
    if (price === null) return null;

    // 스토어명: img.alt
    let storeName: string | null = null;
    try {
      const mallImg = await firstItem.$('.box__logo img');
      if (mallImg) {
        storeName = await mallImg.getAttribute('alt');
      }
    } catch { /* 무시 */ }

    return { price, storeName };
  } catch {
    return null;
  }
}

/** 기존 가격비교 리스트 폴백 */
async function extractListPrice(page: Page): Promise<ScrapeResult | null> {
  try {
    const firstItem = await page.$('.diff_item:first-child');
    if (!firstItem) return null;

    const priceEl = await firstItem.$('.prc_c');
    if (!priceEl) return null;

    const priceText = await priceEl.textContent();
    if (!priceText) return null;

    const price = parsePrice(priceText);
    if (price === null) return null;

    let storeName: string | null = null;
    try {
      const mallImg = await firstItem.$('.d_mall a.link img');
      if (mallImg) {
        storeName = await mallImg.getAttribute('alt');
      }
      if (!storeName) {
        const fallbackImg = await firstItem.$('.d_mall img');
        if (fallbackImg) {
          storeName = await fallbackImg.getAttribute('alt');
        }
      }
    } catch { /* 무시 */ }

    return { price, storeName };
  } catch {
    return null;
  }
}
