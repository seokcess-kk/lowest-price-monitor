import type { Channel, Product, CollectResult } from '@/types/database';
import { createServiceClient } from '@/lib/supabase';
import { randomDelay } from './utils';
import { scrapeCoupang } from './channels/coupang';
import { scrapeNaver } from './channels/naver';
import { scrapeDanawa } from './channels/danawa';

interface ScrapeResult {
  price: number;
  storeName: string | null;
}

type Scraper = (url: string, productName?: string) => Promise<ScrapeResult | null>;

const CHANNEL_SCRAPERS: Record<Channel, Scraper> = {
  coupang: (url) => scrapeCoupang(url),
  naver: (url, productName) => scrapeNaver(url, productName),
  danawa: (url) => scrapeDanawa(url),
};

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

interface CollectSummary {
  success: number;
  failed: number;
  errors: string[];
}

/**
 * 모든 활성 상품의 가격을 수집한다.
 *
 * 세 채널 모두 HTTP 기반(쿠팡/네이버/다나와 모두 Bright Data Web Unlocker)이라
 * 브라우저 인스턴스 없이 fetch만으로 동작. 서버리스/CI 환경에서도 실행 가능.
 */
export async function collectAll(
  options?: { isManual?: boolean }
): Promise<CollectSummary> {
  const isManual = options?.isManual ?? false;
  const supabase = createServiceClient();
  const results: CollectResult[] = [];
  const errors: string[] = [];

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

  const channels: Channel[] = ['danawa', 'coupang', 'naver'];

  // bulk insert를 위해 누적
  const priceRows: Array<{
    product_id: string;
    channel: Channel;
    price: number;
    store_name: string | null;
    is_manual: boolean;
  }> = [];
  const errorRows: Array<{
    product_id: string;
    channel: Channel;
    error_message: string;
  }> = [];

  for (const product of products as Product[]) {
    // 한 상품의 3개 채널은 서로 다른 호스트이므로 동시에 호출
    const channelTasks = channels.map(async (channel): Promise<CollectResult> => {
      const url = getChannelUrl(product, channel);
      if (!url) {
        return { product_id: product.id, channel, success: false, error: 'no_url' };
      }

      const result: CollectResult = {
        product_id: product.id,
        channel,
        success: false,
      };

      try {
        console.log(`[${channel}] ${product.name} 수집 중...`);
        const scraper = CHANNEL_SCRAPERS[channel];
        const scrapeResult = await scraper(url, product.name);

        if (scrapeResult) {
          result.success = true;
          result.price = scrapeResult.price;
          result.store_name = scrapeResult.storeName;
          priceRows.push({
            product_id: product.id,
            channel,
            price: scrapeResult.price,
            store_name: scrapeResult.storeName,
            is_manual: isManual,
          });
        } else {
          result.error = '가격 추출 실패';
          errors.push(`[${channel}] ${product.name}: 가격 추출 실패`);
          errorRows.push({
            product_id: product.id,
            channel,
            error_message: '가격 추출 실패',
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.error = message;
        errors.push(`[${channel}] ${product.name}: ${message}`);
        errorRows.push({
          product_id: product.id,
          channel,
          error_message: message,
        });
      }
      return result;
    });

    const productResults = await Promise.all(channelTasks);
    for (const r of productResults) {
      if (r.error === 'no_url') continue; // URL 없음은 결과에서 제외
      results.push(r);
    }

    // 상품 간에는 호스트 부담을 줄이려 딜레이 유지
    await randomDelay();
  }

  // bulk insert — 라운드트립 최소화
  if (priceRows.length > 0) {
    const { error: insertError } = await supabase.from('price_logs').insert(priceRows);
    if (insertError) {
      const message = `price_logs bulk insert 실패: ${insertError.message}`;
      console.error(message);
      errors.push(message);
      // 저장 실패 시 success로 집계되지 않도록 모두 실패 처리
      for (const r of results) {
        if (r.success) {
          r.success = false;
          r.error = message;
        }
      }
    }
  }
  if (errorRows.length > 0) {
    const { error: errInsertError } = await supabase.from('scrape_errors').insert(errorRows);
    if (errInsertError) {
      console.error(`scrape_errors bulk insert 실패: ${errInsertError.message}`);
    }
  }

  const success = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return { success, failed, errors };
}
