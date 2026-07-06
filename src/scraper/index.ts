import type { Channel, Product, CollectResult } from '@/types/database';
import { createServiceClient } from '@/lib/supabase';
import { cleanupStaleRequests } from '@/lib/collect-cleanup';
import { delay } from './utils';
import { flushUsage } from './brightdata';
import { selectByIdChunks } from '@/lib/query-chunk';
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

/** baseline(dominantPrice) 대비 ±50% 이상 벗어나면 1차 의심 */
const SUSPICIOUS_THRESHOLD = 0.5;
/**
 * 재수집 전 지연 (Bright Data 응답 캐시·CDN 노드 회피 + 호스트 부담 완화).
 * 단품 판매자/묶음 판매자 노출 전환은 수 초 내에도 일어나는 편이라 너무 짧으면 같은 응답이 반복된다.
 */
const RESCAN_DELAY_MS = 5_000;
/** dominantPrice 클러스터를 잡을 때 한 가격을 중심으로 하는 ±폭 (20%) */
const CLUSTER_BAND = 0.2;
/**
 * 상품 단위 동시 처리 개수. Bright Data zone 동시 호출은 PRODUCT_CONCURRENCY × 채널수(최대 3).
 * 쿠팡 우회로 응답이 길어질 때 zone 큐잉으로 timeout이 누적되는 것을 막기 위해 보수적으로 2.
 */
const PRODUCT_CONCURRENCY = 2;
/** 연속 실패한 상품+채널은 Bright Data 호출 전에 잠시 쉬게 해 반복 과금을 막는다. */
const FAILURE_BACKOFF_THRESHOLD = 3;
const FAILURE_BACKOFF_LOOKBACK_DAYS = 30;
const FAILURE_BACKOFF_MAX_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 이 기간(일) 내 정상 가격이 전혀 변하지 않았으면 "무변동"으로 보고 저빈도 수집으로 전환한다. */
const STABLE_WINDOW_DAYS = 14;
/** 무변동으로 판정된 (상품×채널)을 이 주기(일)마다 1회만 수집한다. */
const LOW_FREQ_INTERVAL_DAYS = 3;
/** 무변동 판정에 필요한 이력 조회 기간. STABLE_WINDOW_DAYS + 여유. */
const DIFF_HISTORY_LOOKBACK_DAYS = 15;

interface FailureBackoff {
  consecutiveFailures: number;
  lastFailureAt: string;
  retryAfter: string;
}

/**
 * 7일 정상 가격 시계열에서 "주류 가격대"의 median을 추출한다.
 *
 * 알고리즘:
 *   1. 각 가격 p를 중심으로 [p·(1-CLUSTER_BAND), p·(1+CLUSTER_BAND)] 범위에 들어오는
 *      가격 개수를 센다 — 이 가격대가 얼마나 자주 나타났는지.
 *   2. 카운트가 최대인 중심을 채택. 동률이면 더 높은 가격 쪽 채택
 *      (네이버 묶음 카탈로그에서 단품가 클러스터가 묶음가 클러스터와 동수일 때
 *       "단품 = 비정상" 가정을 깔고 묶음 쪽을 baseline으로 보존).
 *   3. 채택된 중심의 ±CLUSTER_BAND 범위 가격들의 median을 반환.
 */
export function computeDominantPrice(prices: number[]): number {
  const valid = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (valid.length === 0) return 0;
  if (valid.length === 1) return valid[0];

  const sorted = [...valid].sort((a, b) => a - b);
  let bestCount = 0;
  let bestCenter = sorted[Math.floor(sorted.length / 2)];
  for (const p of sorted) {
    const lo = p * (1 - CLUSTER_BAND);
    const hi = p * (1 + CLUSTER_BAND);
    let count = 0;
    for (const x of sorted) if (x >= lo && x <= hi) count++;
    if (count > bestCount || (count === bestCount && p > bestCenter)) {
      bestCount = count;
      bestCenter = p;
    }
  }
  const lo = bestCenter * (1 - CLUSTER_BAND);
  const hi = bestCenter * (1 + CLUSTER_BAND);
  const cluster = sorted.filter((x) => x >= lo && x <= hi);
  const mid = Math.floor(cluster.length / 2);
  return cluster.length % 2 === 0 ? (cluster[mid - 1] + cluster[mid]) / 2 : cluster[mid];
}

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

function productChannelKey(productId: string, channel: Channel): string {
  return `${productId}:${channel}`;
}

function backoffDays(consecutiveFailures: number): number {
  return Math.min(
    FAILURE_BACKOFF_MAX_DAYS,
    Math.max(1, consecutiveFailures - FAILURE_BACKOFF_THRESHOLD + 1)
  );
}

/**
 * 크론 전역 수집에서, 최근 STABLE_WINDOW_DAYS 내 정상 가격이 전혀 변하지 않은
 * (상품×채널)은 LOW_FREQ_INTERVAL_DAYS 주기로만 수집한다.
 * 판정 근거(이력)가 부족하면 매일 수집(false)으로 폴백 — 절감보다 신선도 우선.
 */
function shouldSkipByLowFreq(
  history: { prices: number[]; times: number[] } | undefined,
  now: number
): boolean {
  if (!history) return false;

  const cutoff = now - STABLE_WINDOW_DAYS * DAY_MS;
  const windowPrices: number[] = [];
  for (let i = 0; i < history.times.length; i++) {
    if (history.times[i] >= cutoff) windowPrices.push(history.prices[i]);
  }
  // 판정 근거가 1개 이하면 "무변동"이라 단정할 수 없다 → 수집
  if (windowPrices.length < 2) return false;

  let min = windowPrices[0];
  let max = windowPrices[0];
  for (const p of windowPrices) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  // 창 안에서 가격이 한 번이라도 달라졌으면 신선도 우선 → 매일 수집
  if (min !== max) return false;

  // cron 지터로 수집 시각이 앞뒤로 흔들려도 주기가 밀리지 않도록 0.5일 마진
  const lastCollectedAt = Math.max(...history.times);
  const daysSinceLast = (now - lastCollectedAt) / DAY_MS;
  return daysSinceLast < LOW_FREQ_INTERVAL_DAYS - 0.5;
}

async function getRecentFailureRows(
  supabase: ReturnType<typeof createServiceClient>,
  productIds: string[],
  sinceIso: string
): Promise<Array<{ product_id: string; channel: Channel; created_at: string }>> {
  const { data, error } = await supabase.rpc('recent_failures_per_channel', {
    p_since: sinceIso,
    p_product_ids: productIds,
    p_per_group: 10,
  });

  if (!error) {
    return (data ?? []) as Array<{
      product_id: string;
      channel: Channel;
      created_at: string;
    }>;
  }

  console.warn(
    `[collectAll] recent_failures_per_channel RPC 실패 — fallback 조회 사용: ${error.message}`
  );

  return selectByIdChunks<{ product_id: string; channel: Channel; created_at: string }>(
    productIds,
    (ids, from, to) =>
      supabase
        .from('scrape_errors')
        .select('product_id, channel, created_at')
        .in('product_id', ids)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .range(from, to)
  );
}

async function buildFailureBackoffMap(
  supabase: ReturnType<typeof createServiceClient>,
  products: Product[]
): Promise<Map<string, FailureBackoff>> {
  const productIds = products.map((p) => p.id);
  if (productIds.length === 0) return new Map();

  const sinceIso = new Date(
    Date.now() - FAILURE_BACKOFF_LOOKBACK_DAYS * DAY_MS
  ).toISOString();

  const [failureRows, successRows] = await Promise.all([
    getRecentFailureRows(supabase, productIds, sinceIso),
    selectByIdChunks<{ product_id: string; channel: Channel; collected_at: string }>(
      productIds,
      (ids, from, to) =>
        supabase
          .from('price_logs')
          .select('product_id, channel, collected_at')
          .in('product_id', ids)
          .gte('collected_at', sinceIso)
          .order('collected_at', { ascending: false })
          .range(from, to)
    ),
  ]);

  const lastSuccessTime = new Map<string, number>();
  for (const row of successRows) {
    const key = productChannelKey(row.product_id, row.channel);
    const t = new Date(row.collected_at).getTime();
    const prev = lastSuccessTime.get(key) ?? 0;
    if (Number.isFinite(t) && t > prev) lastSuccessTime.set(key, t);
  }

  const groupedFailures = new Map<string, string[]>();
  for (const row of failureRows) {
    const key = productChannelKey(row.product_id, row.channel);
    const failureTime = new Date(row.created_at).getTime();
    const successTime = lastSuccessTime.get(key) ?? 0;
    if (!Number.isFinite(failureTime) || failureTime <= successTime) continue;
    const arr = groupedFailures.get(key);
    if (arr) arr.push(row.created_at);
    else groupedFailures.set(key, [row.created_at]);
  }

  const now = Date.now();
  const backoffMap = new Map<string, FailureBackoff>();
  for (const [key, failures] of groupedFailures) {
    failures.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    if (failures.length < FAILURE_BACKOFF_THRESHOLD) continue;

    const lastFailureAt = failures[0];
    const lastFailureTime = new Date(lastFailureAt).getTime();
    if (!Number.isFinite(lastFailureTime)) continue;

    const retryAt = lastFailureTime + backoffDays(failures.length) * DAY_MS;
    if (retryAt <= now) continue;

    backoffMap.set(key, {
      consecutiveFailures: failures.length,
      lastFailureAt,
      retryAfter: new Date(retryAt).toISOString(),
    });
  }

  return backoffMap;
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
  // 저빈도 차등은 크론 전역 수집에만 적용 — 즉시 수집(버튼)·상품 지정 수집은 신선도 우선으로 항상 매일 수집
  const applyLowFreqGate = !isManual && !(productIds && productIds.length > 0);
  const supabase = createServiceClient();
  const results: CollectResult[] = [];
  const errors: string[] = [];

  let products: Product[] | null;
  if (productIds && productIds.length > 0) {
    // 배치가 크면 .in('id', [전체])가 URL 길이 한도를 넘으므로 청크 분할 조회
    products = await selectByIdChunks<Product>(productIds, (ids, from, to) =>
      supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .in('id', ids)
        .range(from, to)
    );
  } else {
    const { data, error: fetchError } = await supabase
      .from('products')
      .select('*')
      .eq('is_active', true);
    if (fetchError) {
      throw new Error(`상품 목록 조회 실패: ${fetchError.message}`);
    }
    products = data;
  }

  if (!products || products.length === 0) {
    console.log('수집할 활성 상품이 없습니다.');
    return { success: 0, failed: 0, errors: [] };
  }

  // 전역 실행(productIds 미지정)에서는 현재 개별 수집 진행 중인 상품을 제외
  // 개별/전역 동시 수집 시 중복 price_logs 방지
  let filteredProducts = products as Product[];
  if (!productIds) {
    // 함수 타임아웃으로 영구히 running 박힌 row가 있으면 그 상품을 잘못 제외하게 됨 → 먼저 정리
    try {
      await cleanupStaleRequests();
    } catch (e) {
      console.warn('[collectAll] stale cleanup 실패:', e);
    }
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

  // 이상치 감지용 baseline.
  //
  // 단순 7일 median은 네이버 카탈로그처럼 "묶음 판매자(고가)"와 "단품 판매자(저가)"가
  // 한 카탈로그에 섞여 노출되는 경우를 못 잡는다 — median이 두 가격대 중간에 위치해서
  // 양쪽 다 baseline ±50% 안에 들어와 의심으로 분류되지 않기 때문.
  //
  // 대신 각 가격을 중심으로 ±20% 범위(CLUSTER_BAND)에 속하는 가격들을 카운트하고,
  // 가장 큰 클러스터(=주류 가격대)의 median을 dominantPrice로 잡는다.
  // 동률이면 더 높은 가격 쪽을 채택 — 묶음 SKU 카탈로그에서 단품가 클러스터가 묶음가 클러스터를
  // 카운트로 이기는 경우가 있어, tie 상황에서는 묶음(고가) 쪽으로 편향시킨다.
  const baselineProductIds = filteredProducts.map((p) => p.id);
  const baselineMap = new Map<string, number>(); // key: "productId:channel" → dominantPrice
  // 저빈도 차등 판정용 이력 — baseline 조회를 재활용해 별도 조회 없이 같은 결과로 구성한다.
  const historyMap = new Map<string, { prices: number[]; times: number[] }>(); // key: "productId:channel"
  let failureBackoffMap = new Map<string, FailureBackoff>();
  try {
    const nowMs = Date.now();
    // 조회는 15일로 넓혀 저빈도 판정 이력을 확보하되, baseline은 아래에서 7일 경계로 다시 걸러 기존 동작을 보존한다.
    const lookbackAgo = new Date(nowMs - DIFF_HISTORY_LOOKBACK_DAYS * DAY_MS).toISOString();
    const baselineCutoffMs = nowMs - 7 * DAY_MS;
    // 활성 상품이 많으면 .in(전체)가 URL 길이 한도를 넘어 baseline 조회가 통째로 실패한다 → 청크 분할.
    const recentLogs = await selectByIdChunks<{
      product_id: string;
      channel: Channel;
      price: number;
      collected_at: string;
    }>(baselineProductIds, (ids, from, to) =>
      supabase
        .from('price_logs')
        .select('product_id, channel, price, collected_at')
        .in('product_id', ids)
        .eq('is_suspicious', false)
        .gte('collected_at', lookbackAgo)
        .order('collected_at', { ascending: false })
        .range(from, to)
    );
    const grouped = new Map<string, number[]>();
    for (const log of recentLogs) {
      const key = `${log.product_id}:${log.channel}`;
      const price = log.price as number;
      const t = new Date(log.collected_at).getTime();
      if (!Number.isFinite(t)) continue;
      // baseline(dominantPrice)은 기존과 동일하게 최근 7일 값만 사용
      if (t >= baselineCutoffMs) {
        const arr = grouped.get(key);
        if (arr) arr.push(price);
        else grouped.set(key, [price]);
      }
      // 저빈도 판정은 조회 범위(15일) 전체를 사용
      const entry = historyMap.get(key);
      if (entry) {
        entry.prices.push(price);
        entry.times.push(t);
      } else {
        historyMap.set(key, { prices: [price], times: [t] });
      }
    }
    for (const [key, prices] of grouped) {
      const dominant = computeDominantPrice(prices);
      if (dominant > 0) baselineMap.set(key, dominant);
    }
  } catch (e) {
    console.warn('[collectAll] 이상치 baseline(dominantPrice) 조회 실패 (감지 생략):', e);
  }
  try {
    failureBackoffMap = await buildFailureBackoffMap(supabase, filteredProducts);
    if (failureBackoffMap.size > 0) {
      console.log(
        `[collectAll] 연속 실패 백오프 대상 ${failureBackoffMap.size}개 채널 — Bright Data 호출 skip`
      );
    }
  } catch (e) {
    console.warn('[collectAll] 실패 백오프 조회 실패 (백오프 생략):', e);
  }

  const isOutOfRange = (baseline: number | undefined, curr: number): boolean => {
    if (baseline === undefined || baseline <= 0 || curr <= 0) return false;
    return Math.abs(curr - baseline) / baseline >= SUSPICIOUS_THRESHOLD;
  };

  // 상품 단위로 즉시 저장하기 위한 row 타입.
  // (예전엔 모든 상품을 모아 마지막에 한 번 bulk insert 했으나, 긴 실행이 중단되면
  //  그 사이클의 수집 결과가 통째로 유실되는 문제가 있어 상품 단위 insert로 전환)
  type PriceRow = {
    product_id: string;
    channel: Channel;
    price: number;
    store_name: string | null;
    is_manual: boolean;
    is_suspicious: boolean;
  };
  type ErrorRow = { product_id: string; channel: Channel; error_message: string };

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

  // 저빈도 차등으로 이번 실행에서 skip한 채널 호출 수 (병렬 워커 공유 카운터, 단순 증가라 락 불필요)
  let lowFreqSkipCount = 0;

  const processProduct = async (product: Product): Promise<void> => {
    // 이 상품 분만 누적 — 3채널이 끝나면 즉시 DB에 기록한다.
    const productPriceRows: PriceRow[] = [];
    const productErrorRows: ErrorRow[] = [];
    // URL이 존재하는 채널만 수집 task를 만든다. URL 없는 채널은 Bright Data 호출 대상이 아니다.
    let activeChannels = channels.filter((channel) => !!getChannelUrl(product, channel));
    // 크론 전역 수집에서만: 오래 무변동인 (상품×채널)을 저빈도 주기로 낮춰 Bright Data 호출 자체를 아낀다.
    if (applyLowFreqGate) {
      const now = Date.now();
      activeChannels = activeChannels.filter((channel) => {
        const history = historyMap.get(`${product.id}:${channel}`);
        if (!history || !shouldSkipByLowFreq(history, now)) return true;
        lowFreqSkipCount++;
        const daysSinceLast = ((now - Math.max(...history.times)) / DAY_MS).toFixed(1);
        console.log(
          `[collectAll] 저빈도 차등 skip [${channel}] ${product.name}: ` +
            `${STABLE_WINDOW_DAYS}일 무변동, 마지막 수집 ${daysSinceLast}d 전`
        );
        return false;
      });
    }
    // 한 상품의 채널들은 서로 다른 호스트이므로 동시에 호출
    const channelTasks = activeChannels.map(async (channel): Promise<CollectResult> => {
      const url = getChannelUrl(product, channel);

      const result: CollectResult = {
        product_id: product.id,
        channel,
        success: false,
      };

      if (!url) return { ...result, error: 'no_url' };

      const backoff = failureBackoffMap.get(productChannelKey(product.id, channel));
      if (backoff) {
        console.warn(
          `[collectAll] 연속 실패 백오프 skip [${channel}] ${product.name}: ` +
            `${backoff.consecutiveFailures}회 실패, retryAfter=${backoff.retryAfter}`
        );
        return { ...result, error: 'failure_backoff' };
      }

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
            // baseline 대비 ±50% 벗어남 — 1회 재수집으로 가격대 회복 여부 확인.
            //
            // 이전 정책은 "1차/2차 ±10% 일치 = 확증"으로 받아들였지만,
            // 단품 판매자가 카탈로그에 노출되어 있을 때는 같은 가격이 안정적으로 두 번 잡혀
            // 단품가가 그대로 통과되는 문제가 있었다.
            //
            // 새 정책: 2차도 baseline ±50% 안에 들어와야만 정상으로 간주.
            // 그렇지 않으면 두 호출 다 비정상으로 보고 baseline에 더 가까운 값을 채택 + suspicious=true.
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

            if (secondScrape && !isOutOfRange(baseline, secondScrape.price)) {
              // 2차가 baseline 안으로 회복 → 일시적 노출 흔들림으로 보고 2차 값 채택
              finalPrice = secondScrape.price;
              finalStore = secondScrape.storeName;
              suspicious = false;
              console.log(
                `[collectAll] 재수집 회복 [${channel}] ${product.name}: 1차=${firstScrape.price}, 2차=${secondScrape.price} → 2차 채택`
              );
            } else {
              // 1차·2차 모두 baseline 벗어남 → 의심으로 기록
              // baseline에 더 가까운 값을 채택해 다음 baseline 오염을 최소화
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
          productPriceRows.push({
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
          productErrorRows.push({
            product_id: product.id,
            channel,
            error_message: '가격 추출 실패',
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.error = message;
        errors.push(`[${channel}] ${product.name}: ${message}`);
        productErrorRows.push({
          product_id: product.id,
          channel,
          error_message: message,
        });
      }
      return result;
    });

    const productResults = await Promise.all(channelTasks);

    // 상품 단위 즉시 저장 — 실행이 중간에 끊겨도 여기까지 끝난 상품은 보존된다.
    if (productPriceRows.length > 0) {
      const { error: insertError } = await supabase
        .from('price_logs')
        .insert(productPriceRows);
      if (insertError) {
        const message = `price_logs insert 실패 (${product.name}): ${insertError.message}`;
        console.error(message);
        errors.push(message);
        // 저장 실패한 상품의 성공 결과는 실패로 되돌려 집계 왜곡 방지
        for (const r of productResults) {
          if (r.success) {
            r.success = false;
            r.error = message;
          }
        }
      }
    }
    if (productErrorRows.length > 0) {
      const { error: errInsertError } = await supabase
        .from('scrape_errors')
        .insert(productErrorRows);
      if (errInsertError) {
        console.error(
          `scrape_errors insert 실패 (${product.name}): ${errInsertError.message}`
        );
      }
    }
    // Bright Data 사용량 로그도 상품 단위로 flush — 중단돼도 사용량 추적이 남도록
    await flushUsage();

    for (const r of productResults) {
      if (r.error === 'no_url') continue; // URL 없음은 결과에서 제외
      if (r.error === 'failure_backoff') continue; // 의도적 skip은 실패 집계에서 제외
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

  // price_logs / scrape_errors 는 상품 단위로 이미 저장됨.
  // 동시 처리 중 마지막 상품들의 사용량 버퍼에 남은 것이 있으면 최종 flush.
  await flushUsage();

  const success = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  if (applyLowFreqGate) {
    const totalChannelCalls = filteredProducts.reduce(
      (sum, p) => sum + channels.filter((c) => !!getChannelUrl(p, c)).length,
      0
    );
    console.log(
      `[collectAll] 저빈도 차등으로 채널 호출 ${lowFreqSkipCount}개 절감 (원래 ${totalChannelCalls}개 중)`
    );
  }

  return { success, failed, errors };
}
