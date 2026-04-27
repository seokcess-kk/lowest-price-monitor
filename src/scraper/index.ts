import type { Channel, Product, CollectResult } from '@/types/database';
import { createServiceClient } from '@/lib/supabase';
import { delay } from './utils';
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

/** 직전 baseline(median) 대비 ±50% 이상 벗어나면 1차 의심 */
const SUSPICIOUS_THRESHOLD = 0.5;
/** 1차 값과 재수집 값이 ±10% 이내면 동일 시세로 간주 → 실제 변동으로 수용 */
const RECONFIRM_TOLERANCE = 0.1;
/** 재수집 전 짧은 지연 (Bright Data 캐시 회피 + 호스트 부담 완화) */
const RESCAN_DELAY_MS = 500;
/** 상품 단위 동시 처리 개수. Bright Data zone 동시 호출은 PRODUCT_CONCURRENCY × 채널수(최대 3) */
const PRODUCT_CONCURRENCY = 4;

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
    productIds?: string[];
    onProgress?: (done: number, total: number) => void | Promise<void>;
  }
): Promise<CollectSummary> {
  const isManual = options?.isManual ?? false;
  const productIds = options?.productIds;
  const onProgress = options?.onProgress;
  const supabase = createServiceClient();
  const results: CollectResult[] = [];
  const errors: string[] = [];

  let query = supabase.from('products').select('*').eq('is_active', true);
  if (productIds && productIds.length > 0) {
    query = query.in('id', productIds);
  }
  const { data: products, error: fetchError } = await query;

  if (fetchError) {
    throw new Error(`상품 목록 조회 실패: ${fetchError.message}`);
  }

  if (!products || products.length === 0) {
    console.log('수집할 활성 상품이 없습니다.');
    return { success: 0, failed: 0, errors: [] };
  }

  // 전역 실행(productIds 미지정)에서는 현재 개별 수집 진행 중인 상품을 제외
  // 개별/전역 동시 수집 시 중복 price_logs 방지
  let filteredProducts = products as Product[];
  if (!productIds) {
    try {
      const { data: runningProductReqs } = await supabase
        .from('collect_requests')
        .select('product_id')
        .in('status', ['pending', 'running'])
        .not('product_id', 'is', null);
      const excludeIds = new Set(
        (runningProductReqs ?? [])
          .map((r) => r.product_id as string | null)
          .filter((x): x is string => !!x)
      );
      if (excludeIds.size > 0) {
        const before = filteredProducts.length;
        filteredProducts = filteredProducts.filter((p) => !excludeIds.has(p.id));
        const skipped = before - filteredProducts.length;
        if (skipped > 0) {
          console.log(
            `[collectAll] 개별 수집 진행 중인 상품 ${skipped}개 제외 → ${filteredProducts.length}개 수집`
          );
        }
      }
    } catch (e) {
      console.warn('[collectAll] 개별 수집 진행 상품 조회 실패:', e);
    }
  }

  if (filteredProducts.length === 0) {
    console.log('수집할 상품이 없습니다 (모두 제외됨).');
    return { success: 0, failed: 0, errors: [] };
  }

  console.log(`활성 상품 ${filteredProducts.length}개 발견`);

  const totalProducts = filteredProducts.length;
  let doneProducts = 0;
  if (onProgress) {
    try {
      await onProgress(0, totalProducts);
    } catch (e) {
      console.warn('[collectAll] onProgress(start) 실패:', e);
    }
  }

  const channels: Channel[] = ['danawa', 'coupang', 'naver'];

  // 이상치 감지용 baseline: 각 (productId, channel) → 최근 7일 동안의 정상(is_suspicious=false) 가격 median
  // 단발 이상치가 baseline을 오염시키지 않도록 median 사용
  const baselineProductIds = filteredProducts.map((p) => p.id);
  const baselineMap = new Map<string, number>(); // key: "productId:channel" → median
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentLogs } = await supabase
      .from('price_logs')
      .select('product_id, channel, price')
      .in('product_id', baselineProductIds)
      .eq('is_suspicious', false)
      .gte('collected_at', sevenDaysAgo)
      .order('collected_at', { ascending: false })
      .limit(10000);
    const grouped = new Map<string, number[]>();
    for (const log of recentLogs ?? []) {
      const key = `${log.product_id}:${log.channel}`;
      const arr = grouped.get(key);
      if (arr) arr.push(log.price as number);
      else grouped.set(key, [log.price as number]);
    }
    for (const [key, prices] of grouped) {
      const sorted = [...prices].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      baselineMap.set(key, median);
    }
  } catch (e) {
    console.warn('[collectAll] 이상치 baseline(median) 조회 실패 (감지 생략):', e);
  }

  const isOutOfRange = (baseline: number | undefined, curr: number): boolean => {
    if (baseline === undefined || baseline <= 0 || curr <= 0) return false;
    return Math.abs(curr - baseline) / baseline >= SUSPICIOUS_THRESHOLD;
  };

  const isWithinTolerance = (a: number, b: number): boolean => {
    if (a <= 0 || b <= 0) return false;
    return Math.abs(a - b) / a <= RECONFIRM_TOLERANCE;
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

  // 진행률 콜백을 직렬화: 워커들이 동시에 완료해도 done 값이 역행하지 않도록
  // (값 capture는 워커 안에서 동기적으로 ++ 한 직후 enqueue → enqueue 순서 = done 순서)
  let progressChain: Promise<void> = Promise.resolve();
  const reportProgress = (done: number): void => {
    if (!onProgress) return;
    progressChain = progressChain.then(async () => {
      try {
        await onProgress(done, totalProducts);
      } catch (e) {
        console.warn('[collectAll] onProgress 실패:', e);
      }
    });
  };

  const processProduct = async (product: Product): Promise<void> => {
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
        const firstScrape = await scraper(url, product.name);

        if (firstScrape) {
          const baseline = baselineMap.get(`${product.id}:${channel}`);
          let finalPrice = firstScrape.price;
          let finalStore = firstScrape.storeName;
          let suspicious = false;

          if (isOutOfRange(baseline, firstScrape.price)) {
            // baseline 대비 ±50% 벗어남 — 1회 재수집으로 확증 시도
            const ratioPct = baseline
              ? (((firstScrape.price - baseline) / baseline) * 100).toFixed(1)
              : 'n/a';
            console.warn(
              `[collectAll] 이상치 후보 [${channel}] ${product.name}: baseline=${baseline} → ${firstScrape.price} (${ratioPct}%) — 재수집 시도`
            );

            await delay(RESCAN_DELAY_MS);
            let secondScrape: ScrapeResult | null = null;
            try {
              secondScrape = await scraper(url, product.name);
            } catch (rescanErr) {
              console.warn(
                `[collectAll] 재수집 실패 [${channel}] ${product.name}:`,
                rescanErr
              );
            }

            if (secondScrape && isWithinTolerance(firstScrape.price, secondScrape.price)) {
              // 두 번 모두 비슷한 값 → 실제 가격 변동으로 수용
              finalPrice = secondScrape.price;
              finalStore = secondScrape.storeName;
              suspicious = false;
              console.log(
                `[collectAll] 재수집 확증 [${channel}] ${product.name}: ${firstScrape.price} ≈ ${secondScrape.price} → 수용`
              );
            } else {
              // 일관성 없음 → 의심 플래그 유지
              // 2차가 baseline에 더 가까우면 그 값을 채택, 아니면 1차 값을 그대로 기록
              if (
                secondScrape &&
                baseline !== undefined &&
                Math.abs(secondScrape.price - baseline) <
                  Math.abs(firstScrape.price - baseline)
              ) {
                finalPrice = secondScrape.price;
                finalStore = secondScrape.storeName;
              }
              suspicious = true;
              console.warn(
                `[collectAll] 재수집 비일관 [${channel}] ${product.name}: 1차=${firstScrape.price}, 2차=${secondScrape?.price ?? 'null'} → is_suspicious=true`
              );
            }
          }

          result.success = true;
          result.price = finalPrice;
          result.store_name = finalStore;
          priceRows.push({
            product_id: product.id,
            channel,
            price: finalPrice,
            store_name: finalStore,
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

    const v = ++doneProducts;
    reportProgress(v);
  };

  // 상품 단위 워커 풀 — 동시 PRODUCT_CONCURRENCY개 처리.
  // 한 상품 내 3채널 병렬 × 동시 상품 수 = Bright Data zone에 동시 in-flight 호출 상한.
  const queue = [...filteredProducts];
  const worker = async (): Promise<void> => {
    while (true) {
      const product = queue.shift();
      if (!product) return;
      await processProduct(product);
    }
  };
  const workerCount = Math.min(PRODUCT_CONCURRENCY, filteredProducts.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  // 마지막 progress 콜백까지 flush
  await progressChain;

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
