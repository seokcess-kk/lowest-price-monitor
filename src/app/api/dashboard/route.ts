import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type {
  Channel,
  ChangeFilterKey,
  ChannelPrice,
  DashboardResponse,
  FailureWarning,
  PriceLog,
  PriceWithChange,
  ProductIdsResponse,
} from '@/types/database';
import {
  dateKeyKST,
  daysAgoKeyKST,
  startOfDayKstISO,
  endOfDayKstISO,
} from '@/lib/date-utils';
import { selectAllRange, selectByIdChunks } from '@/lib/query-chunk';
import { resolveSearchBrandIds, UNCATEGORIZED_BRAND_ID } from '@/lib/products-query';
import {
  computePanelGroups,
  computeSummary,
  hasAnyChange,
  hasBigDrop,
  hasDrop,
  hasFailure,
  hasMissing,
  hasRise,
} from '@/lib/price-utils';

type Supabase = ReturnType<typeof createServiceClient>;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const CHANNELS: Channel[] = ['coupang', 'naver', 'danawa'];

interface ProductRow {
  id: string;
  name: string;
  sabangnet_code: string | null;
  brand_id: string | null;
  brand?: { id: string; name: string } | null;
  coupang_url: string | null;
  naver_url: string | null;
  danawa_url: string | null;
}

/**
 * 대시보드 메인 화면용 통합 라우트 (v2 — 서버 필터/집계/페이지네이션).
 *
 * 5,000상품 전체의 latest+sparkline을 한 응답에 담으면 수 MB가 되므로:
 *  - 검색(q)·브랜드·변동 필터를 서버에서 적용
 *  - 집계(SummaryCards/FilterChips/ActionPanels/브랜드 카운트)는 전체 필터셋 기준으로 계산
 *  - items는 페이지 슬라이스만, sparklines는 페이지 내 상품만 조회
 *  - 현재가는 price_daily(오늘/어제 2일 슬라이스)에서 — product .in() 없이 날짜 인덱스 스캔
 *
 * ?ids_only=true → 필터 결과 전체의 { ids, total } ("필터된 N개 수집"용)
 * ?all=true      → 페이지네이션 없이 전체 items (엑셀 스냅샷용, sparklines 제외)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.max(2, Math.min(parseInt(searchParams.get('days') || '7', 10), 30));
    const q = (searchParams.get('q') ?? '').trim();
    const brandIds = (searchParams.get('brand_ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const rawFilter = searchParams.get('filter');
    const changeFilter: ChangeFilterKey =
      rawFilter === 'changed' ||
      rawFilter === 'bigDrop' ||
      rawFilter === 'failed' ||
      rawFilter === 'drops' ||
      rawFilter === 'rises' ||
      rawFilter === 'missing'
        ? rawFilter
        : 'all';
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get('page_size') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
    );
    const idsOnly = searchParams.get('ids_only') === 'true';
    const wantAll = searchParams.get('all') === 'true';

    const supabase = createServiceClient();

    // 1) 활성 상품 전체 (검색어만 적용 — brand_counts가 "검색 후" 기준이라 브랜드 필터 전 셋도 필요)
    const searchBrandIds = await resolveSearchBrandIds(supabase, q);
    const searchedProducts = await selectAllRange<ProductRow>((from, to) => {
      let query = supabase
        .from('products')
        .select('id, name, sabangnet_code, brand_id, brand:brands(id, name), coupang_url, naver_url, danawa_url')
        .eq('is_active', true);
      if (q) {
        const term = q.replace(/[\\%_]/g, (m) => `\\${m}`).replace(/[,()]/g, ' ').trim();
        if (term) {
          const orParts = [`name.ilike.*${term}*`, `sabangnet_code.ilike.*${term}*`];
          if (searchBrandIds.length > 0) {
            orParts.push(`brand_id.in.(${searchBrandIds.join(',')})`);
          }
          query = query.or(orParts.join(','));
        }
      }
      return query
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to);
    });

    // 브랜드 필터 적용 셋 — summary/filter_counts/panel/목록의 기준
    const products =
      brandIds.length === 0
        ? searchedProducts
        : searchedProducts.filter((p) => {
            if (p.brand_id) return brandIds.includes(p.brand_id);
            return brandIds.includes(UNCATEGORIZED_BRAND_ID);
          });

    if (products.length === 0) {
      if (idsOnly) {
        const empty: ProductIdsResponse = { ids: [], total: 0 };
        return NextResponse.json(empty);
      }
      const empty: DashboardResponse = {
        items: [],
        sparklines: {},
        total: 0,
        page,
        page_size: pageSize,
        summary: computeSummary([]),
        filter_counts: { all: 0, changed: 0, bigDrop: 0, failed: 0 },
        panel: computePanelGroups([]),
        brand_counts: buildBrandCounts(searchedProducts),
        lastCollectedAt: await buildLastCollectedAt(supabase).catch(() => null),
      };
      return NextResponse.json(empty);
    }

    const productIds = products.map((p) => p.id);

    // 2) 전체 필터셋의 현재가/경고 조립 (price_daily 2일 슬라이스, 폴백: price_logs)
    const [allItems, lastCollectedAt] = await Promise.all([
      buildItems(supabase, products, productIds),
      buildLastCollectedAt(supabase),
    ]);

    // 3) 전체 기준 집계
    const summary = computeSummary(allItems);
    const filterCounts = {
      all: allItems.length,
      changed: allItems.filter(hasAnyChange).length,
      bigDrop: allItems.filter((i) => hasBigDrop(i)).length,
      failed: allItems.filter(hasFailure).length,
    };
    const panel = computePanelGroups(allItems);
    const brandCounts = buildBrandCounts(searchedProducts);

    // 4) 변동 필터 적용
    const filteredItems = allItems.filter((item) => {
      if (changeFilter === 'changed') return hasAnyChange(item);
      if (changeFilter === 'bigDrop') return hasBigDrop(item);
      if (changeFilter === 'failed') return hasFailure(item);
      if (changeFilter === 'drops') return hasDrop(item);
      if (changeFilter === 'rises') return hasRise(item);
      if (changeFilter === 'missing') return hasMissing(item);
      return true;
    });

    if (idsOnly) {
      const body: ProductIdsResponse = {
        ids: filteredItems.map((i) => i.product_id),
        total: filteredItems.length,
      };
      return NextResponse.json(body);
    }

    // 5) 페이지 슬라이스 + 페이지 상품만 sparkline
    const pageItems = wantAll
      ? filteredItems
      : filteredItems.slice((page - 1) * pageSize, page * pageSize);
    const sparklines = wantAll
      ? {}
      : await buildSparklines(supabase, pageItems.map((i) => i.product_id), days);

    const body: DashboardResponse = {
      items: pageItems,
      sparklines,
      total: filteredItems.length,
      page: wantAll ? 1 : page,
      page_size: wantAll ? filteredItems.length : pageSize,
      summary,
      filter_counts: filterCounts,
      panel,
      brand_counts: brandCounts,
      lastCollectedAt,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error('[api/dashboard]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function buildBrandCounts(products: ProductRow[]): DashboardResponse['brand_counts'] {
  const byId: Record<string, number> = {};
  let uncategorized = 0;
  for (const p of products) {
    if (p.brand_id) byId[p.brand_id] = (byId[p.brand_id] ?? 0) + 1;
    else uncategorized++;
  }
  return { byId, uncategorized };
}

interface DailySlice {
  product_id: string;
  channel: Channel;
  date: string;
  latest_price: number;
  latest_store_name: string | null;
  latest_is_suspicious: boolean;
}

/**
 * 전체 필터셋의 PriceWithChange 조립.
 * 현재가는 price_daily의 latest_*(그날 최신, 정상 우선) — 기존 price_logs 직접 조회의
 * findFor(normal-first) 로직과 의미 동일. 오늘·어제 슬라이스가 모두 비면(백필 전 배포 등)
 * 기존 price_logs 경로로 폴백해 배포 순서 사고를 방지한다.
 */
async function buildItems(
  supabase: Supabase,
  products: ProductRow[],
  productIds: string[]
): Promise<PriceWithChange[]> {
  const todayStr = dateKeyKST();
  const yesterdayStr = daysAgoKeyKST(1);

  // (product:channel) → { today?: DailySlice; yesterday?: DailySlice }
  const dailyIndex = new Map<string, { today?: DailySlice; yesterday?: DailySlice }>();
  let dailyAvailable = false;
  try {
    // product .in() 불필요 — 날짜 인덱스 단일 스캔 (5,000상품 × 3채널 × 2일 ≤ 3만 행)
    const slice = await selectAllRange<DailySlice>((from, to) =>
      supabase
        .from('price_daily')
        .select('product_id, channel, date, latest_price, latest_store_name, latest_is_suspicious')
        .in('date', [todayStr, yesterdayStr])
        .order('product_id', { ascending: true })
        .order('channel', { ascending: true })
        .order('date', { ascending: true })
        .range(from, to)
    );
    if (slice.length > 0) {
      dailyAvailable = true;
      const idSet = new Set(productIds);
      for (const row of slice) {
        if (!idSet.has(row.product_id)) continue;
        const key = `${row.product_id}:${row.channel}`;
        let entry = dailyIndex.get(key);
        if (!entry) {
          entry = {};
          dailyIndex.set(key, entry);
        }
        if (row.date === todayStr) entry.today = row;
        else if (row.date === yesterdayStr) entry.yesterday = row;
      }
    }
  } catch (e) {
    console.warn('[api/dashboard] price_daily 조회 실패 — price_logs 폴백:', e);
  }

  // 폴백: price_daily 미적용/백필 전 환경 — 기존 2일 로그 청크 조회
  const logIndex = new Map<string, PriceLog[]>();
  if (!dailyAvailable) {
    const logs = await selectByIdChunks<PriceLog>(productIds, (ids, from, to) =>
      supabase
        .from('price_logs')
        .select('*')
        .in('product_id', ids)
        .gte('collected_at', startOfDayKstISO(yesterdayStr))
        .lte('collected_at', endOfDayKstISO(todayStr))
        .order('collected_at', { ascending: false })
        .range(from, to)
    );
    for (const log of logs) {
      const key = `${log.product_id}:${log.channel}`;
      const arr = logIndex.get(key);
      if (arr) arr.push(log);
      else logIndex.set(key, [log]);
    }
  }

  const warningsMap = await buildWarnings(supabase, productIds);

  return products.map((product) => {
    const prices: ChannelPrice[] = CHANNELS.map((channel) => {
      const key = `${product.id}:${channel}`;

      if (dailyAvailable) {
        const entry = dailyIndex.get(key);
        const today = entry?.today;
        const yesterday = entry?.yesterday;
        const source = today ?? yesterday;
        const change =
          today && yesterday ? today.latest_price - yesterday.latest_price : null;
        return {
          channel,
          price: source?.latest_price ?? 0,
          store_name: source?.latest_store_name ?? null,
          change,
          is_suspicious: source?.latest_is_suspicious === true ? true : undefined,
        };
      }

      // 폴백 경로 — 기존 findFor(정상 우선) 로직 그대로
      const channelLogs = logIndex.get(key) ?? [];
      const normal = channelLogs.filter((l) => !l.is_suspicious);
      const findFor = (arr: PriceLog[], dayKey: string): PriceLog | undefined =>
        arr.find((l) => dateKeyKST(l.collected_at) === dayKey);
      const todayLog = findFor(normal, todayStr) ?? findFor(channelLogs, todayStr);
      const yesterdayLog =
        findFor(normal, yesterdayStr) ?? findFor(channelLogs, yesterdayStr);
      const sourceLog = todayLog ?? yesterdayLog;
      return {
        channel,
        price: sourceLog?.price ?? 0,
        store_name: sourceLog?.store_name ?? null,
        change: todayLog && yesterdayLog ? todayLog.price - yesterdayLog.price : null,
        is_suspicious: sourceLog?.is_suspicious === true ? true : undefined,
      };
    });

    const warnings = warningsMap.get(product.id);
    return {
      product_id: product.id,
      product_name: product.name,
      sabangnet_code: product.sabangnet_code ?? null,
      brand_id: product.brand_id ?? null,
      brand_name: product.brand?.name ?? null,
      urls: {
        coupang: product.coupang_url,
        naver: product.naver_url,
        danawa: product.danawa_url,
      },
      prices,
      warnings: warnings && warnings.length > 0 ? warnings : undefined,
    };
  });
}

/**
 * 연속 3회 이상 실패한 (상품×채널) 경고 맵.
 * RPC 결과도 PostgREST 1,000행 상한이 있어, 꽉 찬 응답(=절단 의심)이면 청크 전수 조회로 폴백.
 */
async function buildWarnings(
  supabase: Supabase,
  productIds: string[]
): Promise<Map<string, FailureWarning[]>> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  type ErrorRow = { product_id: string; channel: Channel; created_at: string };

  let recentErrors: ErrorRow[] = [];
  const { data: rpcRows, error: rpcErr } = await supabase.rpc('recent_failures_per_channel', {
    p_since: sevenDaysAgo,
    p_product_ids: productIds,
    p_per_group: 10,
  });
  if (!rpcErr && Array.isArray(rpcRows) && rpcRows.length < 1000) {
    recentErrors = rpcRows as ErrorRow[];
  } else {
    recentErrors = await selectByIdChunks<ErrorRow>(productIds, (ids, from, to) =>
      supabase
        .from('scrape_errors')
        .select('product_id, channel, created_at')
        .in('product_id', ids)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .range(from, to)
    );
  }

  // "연속 실패"는 마지막 성공 수집 이후의 실패만 센다
  const lastSuccessMap = new Map<string, number>();
  if (recentErrors.length > 0) {
    const failingIds = Array.from(new Set(recentErrors.map((r) => r.product_id)));
    const successRows = await selectByIdChunks<{
      product_id: string;
      channel: Channel;
      collected_at: string;
    }>(failingIds, (ids, from, to) =>
      supabase
        .from('price_logs')
        .select('product_id, channel, collected_at')
        .in('product_id', ids)
        .gte('collected_at', sevenDaysAgo)
        .order('collected_at', { ascending: false })
        .range(from, to)
    );
    for (const row of successRows) {
      const key = `${row.product_id}:${row.channel}`;
      const t = new Date(row.collected_at).getTime();
      const prev = lastSuccessMap.get(key) ?? 0;
      if (Number.isFinite(t) && t > prev) lastSuccessMap.set(key, t);
    }
  }

  const failureMap = new Map<string, number>();
  {
    const grouped = new Map<string, string[]>();
    for (const err of recentErrors) {
      const key = `${err.product_id}:${err.channel}`;
      const arr = grouped.get(key);
      if (arr) arr.push(err.created_at);
      else grouped.set(key, [err.created_at]);
    }
    for (const [key, timestamps] of grouped) {
      const latestSuccessTime = lastSuccessMap.get(key) ?? 0;
      let consecutive = 0;
      for (const t of timestamps) {
        if (new Date(t).getTime() > latestSuccessTime) consecutive++;
      }
      if (consecutive >= 3) failureMap.set(key, consecutive);
    }
  }

  // 실패 셋에 한해 최신 실패 사유/시각 보충
  const messageMap = new Map<string, { message: string; at: string }>();
  if (failureMap.size > 0) {
    const failingProductIds = Array.from(
      new Set(Array.from(failureMap.keys()).map((k) => k.split(':')[0]))
    );
    type MsgRow = {
      product_id: string;
      channel: string;
      error_message: string;
      created_at: string;
    };
    const msgRows = await selectByIdChunks<MsgRow>(failingProductIds, (ids, from, to) =>
      supabase
        .from('scrape_errors')
        .select('product_id, channel, error_message, created_at')
        .in('product_id', ids)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .range(from, to)
    );
    for (const r of msgRows) {
      const key = `${r.product_id}:${r.channel}`;
      // order desc 이므로 키별 첫 등장 = 최신
      if (!messageMap.has(key)) {
        messageMap.set(key, { message: r.error_message, at: r.created_at });
      }
    }
  }

  const result = new Map<string, FailureWarning[]>();
  for (const [key, count] of failureMap) {
    const [productId, channel] = key.split(':') as [string, Channel];
    const msg = messageMap.get(key);
    const warning: FailureWarning = {
      product_id: productId,
      channel,
      consecutive_failures: count,
      last_failure_message: msg?.message ?? '',
      last_failure_at: msg?.at ?? '',
    };
    const arr = result.get(productId);
    if (arr) arr.push(warning);
    else result.set(productId, [warning]);
  }
  return result;
}

/**
 * 페이지 내 상품만의 스파크라인 — price_daily의 min_price(정상 일 최저) 기반.
 * 채널 구분 없이 그날 최저 하나. price_daily가 없으면 기존 price_logs 폴백.
 */
async function buildSparklines(
  supabase: Supabase,
  productIds: string[],
  days: number
): Promise<Record<string, number[]>> {
  if (productIds.length === 0) return {};
  const sinceKey = daysAgoKeyKST(days - 1);

  // (product → day → min price)
  const grouped = new Map<string, Map<string, number>>();
  let dailyOk = false;
  try {
    const rows = await selectByIdChunks<{
      product_id: string;
      date: string;
      min_price: number | null;
    }>(productIds, (ids, from, to) =>
      supabase
        .from('price_daily')
        .select('product_id, date, min_price')
        .in('product_id', ids)
        .gte('date', sinceKey)
        .not('min_price', 'is', null)
        .order('date', { ascending: true })
        .range(from, to)
    );
    dailyOk = true;
    for (const row of rows) {
      if (row.min_price === null) continue;
      if (!grouped.has(row.product_id)) grouped.set(row.product_id, new Map());
      const dayMap = grouped.get(row.product_id)!;
      const prev = dayMap.get(row.date);
      if (prev === undefined || row.min_price < prev) dayMap.set(row.date, row.min_price);
    }
  } catch (e) {
    console.warn('[api/dashboard] sparkline price_daily 조회 실패 — price_logs 폴백:', e);
  }

  if (!dailyOk || grouped.size === 0) {
    const logs = await selectByIdChunks<{
      product_id: string;
      price: number;
      collected_at: string;
    }>(productIds, (ids, from, to) =>
      supabase
        .from('price_logs')
        .select('product_id, price, collected_at')
        .in('product_id', ids)
        .eq('is_suspicious', false)
        .gte('collected_at', startOfDayKstISO(sinceKey))
        .range(from, to)
    );
    for (const log of logs) {
      const day = dateKeyKST(log.collected_at);
      if (!grouped.has(log.product_id)) grouped.set(log.product_id, new Map());
      const dayMap = grouped.get(log.product_id)!;
      const prev = dayMap.get(day);
      if (prev === undefined || log.price < prev) dayMap.set(day, log.price);
    }
  }

  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dayKeys.push(daysAgoKeyKST(i));
  }

  const result: Record<string, number[]> = {};
  for (const pid of productIds) {
    const dayMap = grouped.get(pid);
    const arr: number[] = [];
    let lastSeen: number | null = null;
    for (const dayKey of dayKeys) {
      const v = dayMap?.get(dayKey);
      if (v !== undefined) {
        lastSeen = v;
        arr.push(v);
      } else if (lastSeen !== null) {
        arr.push(lastSeen);
      }
    }
    result[pid] = arr.length >= 2 ? arr : [];
  }

  return result;
}

async function buildLastCollectedAt(supabase: Supabase): Promise<string | null> {
  const { data, error } = await supabase
    .from('price_logs')
    .select('collected_at')
    .order('collected_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.collected_at ?? null;
}
