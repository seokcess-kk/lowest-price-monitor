import type { Page } from 'playwright';
import type { Channel, Product, CollectResult } from '@/types/database';
import { createServiceClient } from '@/lib/supabase';
import { createBrowser, randomDelay, BROWSER_CONTEXT_OPTIONS } from './utils';
import { scrapeCoupang } from './channels/coupang';
import { scrapeNaver } from './channels/naver';
import { scrapeDanawa } from './channels/danawa';

/** ScrapeResult 인터페이스 */
interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/** 채널별 스크래퍼 매핑 */
const CHANNEL_SCRAPERS: Record<
  Channel,
  (url: string, page: Page) => Promise<ScrapeResult | null>
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
  const browser = await createBrowser();
  const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);

  try {
    const channels: Channel[] = ['coupang', 'naver', 'danawa'];

    for (const product of products as Product[]) {
      for (const channel of channels) {
        const url = getChannelUrl(product, channel);
        if (!url) continue; // URL 미등록 채널은 건너뜀

        const result: CollectResult = {
          product_id: product.id,
          channel,
          success: false,
        };

        try {
          const page = await context.newPage();
          try {
            console.log(`[${channel}] ${product.name} 수집 중...`);

            const scraper = CHANNEL_SCRAPERS[channel];
            const scrapeResult = await scraper(url, page);

            if (scrapeResult) {
              result.success = true;
              result.price = scrapeResult.price;
              result.store_name = scrapeResult.storeName;

              // price_logs에 insert
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

              // 에러 로그를 DB에 저장
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

          // 에러 로그를 DB에 저장
          await supabase.from('scrape_errors').insert({
            product_id: product.id,
            channel,
            error_message: message,
          }).then(() => {}, () => {}); // 에러 로그 저장 실패는 무시
        }

        results.push(result);

        // 채널 간 2~5초 랜덤 딜레이
        await randomDelay();
      }
    }
  } finally {
    // 5. 브라우저 종료
    await context.close();
    await browser.close();
  }

  // 6. 결과 요약
  const success = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return { success, failed, errors };
}
