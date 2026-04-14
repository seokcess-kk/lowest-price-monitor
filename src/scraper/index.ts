import type { Channel, Product, CollectResult } from '@/types/database';
import { createServiceClient } from '@/lib/supabase';
import { randomDelay } from './utils';
import { flushUsage } from './brightdata';
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
 *
 * onProgress 콜백이 주어지면 시작 시 (0, total), 매 상품 완료 시 (done, total)을 통보한다.
 * 콜백 실패는 수집 흐름을 중단시키지 않는다.
 */
export async function collectAll(
  options?: {
    isManual?: boolean;
    onProgress?: (done: number, total: number) => void | Promise<void>;
  }
): Promise<CollectSummary> {
  const isManual = options?.isManual ?? false;
  const onProgress = options?.onProgress;
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

  const totalProducts = (products as Product[]).length;
  let doneProducts = 0;
  if (onProgress) {
    try {
      await onProgress(0, totalProducts);
    } catch (e) {
      console.warn('[collectAll] onProgress(start) 실패:', e);
    }
  }

  const channels: Channel[] = ['danawa', 'coupang', 'naver'];

  // 이상치 감지용: 각 (productId, channel) → 가장 최근 수집가 lookup
  // 한 번의 쿼리로 전체 활성 상품의 직전 가격을 가져와 Map으로 인덱싱
  const productIds = (products as Product[]).map((p) => p.id);
  const previousMap = new Map<string, number>(); // key: "productId:channel"
  try {
    const { data: recentLogs } = await supabase
      .from('price_logs')
      .select('product_id, channel, price, collected_at')
      .in('product_id', productIds)
      .order('collected_at', { ascending: false })
      .limit(5000);
    for (const log of recentLogs ?? []) {
      const key = `${log.product_id}:${log.channel}`;
      if (!previousMap.has(key)) {
        previousMap.set(key, log.price as number);
      }
    }
  } catch (e) {
    console.warn('[collectAll] 이상치 baseline 조회 실패 (감지 생략):', e);
  }

  /** 직전 값 대비 50% 이상 변동 → 이상치 */
  const SUSPICIOUS_THRESHOLD = 0.5;
  const isSuspicious = (prev: number | undefined, curr: number): boolean => {
    if (prev === undefined || prev <= 0 || curr <= 0) return false;
    const ratio = Math.abs(curr - prev) / prev;
    return ratio >= SUSPICIOUS_THRESHOLD;
  };

  // bulk insert를 위해 누적
  const priceRows: Array<{
    product_id: string;
    channel: Channel;
    price: number;
    store_name: string | null;
    is_manual: boolean;
    is_suspicious: boolean;
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
          const prev = previousMap.get(`${product.id}:${channel}`);
          const suspicious = isSuspicious(prev, scrapeResult.price);
          if (suspicious) {
            const ratioPct = prev
              ? (((scrapeResult.price - prev) / prev) * 100).toFixed(1)
              : 'n/a';
            console.warn(
              `[collectAll] 이상치 감지 [${channel}] ${product.name}: ${prev} → ${scrapeResult.price} (${ratioPct}%)`
            );
          }
          priceRows.push({
            product_id: product.id,
            channel,
            price: scrapeResult.price,
            store_name: scrapeResult.storeName,
            is_manual: isManual,
            is_suspicious: suspicious,
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

    doneProducts++;
    if (onProgress) {
      try {
        await onProgress(doneProducts, totalProducts);
      } catch (e) {
        console.warn('[collectAll] onProgress 실패:', e);
      }
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

  // Bright Data 사용량 로그 flush
  await flushUsage();

  const success = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return { success, failed, errors };
}
