import type { Page } from 'playwright';
import type { Channel, Product, CollectResult } from '@/types/database';
import { createServiceClient } from '@/lib/supabase';
import { createBrowser, createCoupangBrowser, randomDelay, BROWSER_CONTEXT_OPTIONS } from './utils';
import { scrapeCoupang } from './channels/coupang';
import { scrapeNaver } from './channels/naver';
import { scrapeDanawa } from './channels/danawa';

/** ScrapeResult 인터페이스 */
interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/** 채널별 스크래퍼 매핑 (productName은 API 기반 채널에서 사용) */
const CHANNEL_SCRAPERS: Record<
  Channel,
  (url: string, page: Page, productName?: string) => Promise<ScrapeResult | null>
> = {
  coupang: scrapeCoupang,
  naver: scrapeNaver,
  danawa: scrapeDanawa,
};

/** 상품에서 채널별 URL을 가져온다 */
function getChannelUrl(product: Product, channel: Channel): string | null {
  switch (channel) {
    case 'coupang':
      return product.coupang_url;
    case 'naver':
      return product.naver_url;
    case 'danawa':
      return product.danawa_url;
    default:
      return null;
  }
}

/** 수집 결과 요약 */
interface CollectSummary {
  success: number;
  failed: number;
  errors: string[];
}

/**
 * 모든 활성 상품의 가격을 수집한다.
 *
 * 1. Supabase에서 활성 상품 목록 조회
 * 2. 브라우저 인스턴스 생성
 * 3. 각 상품의 등록된 채널별로 수집 실행 (채널 간 2~5초 딜레이)
 * 4. 수집 결과를 price_logs에 insert
 * 5. 브라우저 종료
 * 6. 결과 요약 반환
 */
export async function collectAll(
  options?: { isManual?: boolean }
): Promise<CollectSummary> {
  const isManual = options?.isManual ?? false;
  const supabase = createServiceClient();
  const results: CollectResult[] = [];
  const errors: string[] = [];

  // 1. 활성 상품 목록 조회
  const { data: products, error: fetchError } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true);

  if (fetchError) {
    throw new Error(`상품 목록 조회 실패: ${fetchError.message}`);
  }

  if (!products || products.length === 0) {
    console.log('수집할 활성 상품이 없습니다.');
    return { success: 0, failed: 0, errors: [] };
  }

  console.log(`활성 상품 ${products.length}개 발견`);

  // 2. 브라우저 인스턴스 생성
  //    - 쿠팡: persistent context (headless: false 필수, 봇 감지 우회)
  //    - 다나와/네이버: 일반 headless 브라우저
  const browser = await createBrowser();
  const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);

  // 쿠팡 전용 브라우저 (로컬 환경에서만 생성)
  const hasCoupangProducts = (products as Product[]).some((p) => p.coupang_url);
  const coupangBrowser = hasCoupangProducts ? await createCoupangBrowser() : null;

  try {
    const channels: Channel[] = ['danawa', 'coupang', 'naver'];

    for (const product of products as Product[]) {
      for (const channel of channels) {
        const url = getChannelUrl(product, channel);
        if (!url) continue;

        const result: CollectResult = {
          product_id: product.id,
          channel,
          success: false,
        };

        try {
          // 쿠팡은 전용 브라우저 사용, 나머지는 일반 브라우저
          const isCoupang = channel === 'coupang';
          const page = isCoupang && coupangBrowser
            ? await coupangBrowser.newPage()
            : await context.newPage();

          try {
            console.log(`[${channel}] ${product.name} 수집 중...`);

            const scraper = CHANNEL_SCRAPERS[channel];
            const scrapeResult = await scraper(url, page, product.name);

            if (scrapeResult) {
              result.success = true;
              result.price = scrapeResult.price;
              result.store_name = scrapeResult.storeName;

              const { error: insertError } = await supabase
                .from('price_logs')
                .insert({
                  product_id: product.id,
                  channel,
                  price: scrapeResult.price,
                  store_name: scrapeResult.storeName,
                  is_manual: isManual,
                });

              if (insertError) {
                result.success = false;
                result.error = `DB 저장 실패: ${insertError.message}`;
                errors.push(
                  `[${channel}] ${product.name}: ${result.error}`
                );
              }
            } else {
              result.error = '가격 추출 실패';
              errors.push(
                `[${channel}] ${product.name}: 가격 추출 실패`
              );

              await supabase.from('scrape_errors').insert({
                product_id: product.id,
                channel,
                error_message: '가격 추출 실패',
              });
            }
          } finally {
            await page.close();
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          result.error = message;
          errors.push(`[${channel}] ${product.name}: ${message}`);

          await supabase.from('scrape_errors').insert({
            product_id: product.id,
            channel,
            error_message: message,
          }).then(() => {}, () => {});
        }

        results.push(result);
        await randomDelay();
      }
    }
  } finally {
    await context.close();
    await browser.close();
    if (coupangBrowser) await coupangBrowser.close();
  }

  // 6. 결과 요약
  const success = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return { success, failed, errors };
}
