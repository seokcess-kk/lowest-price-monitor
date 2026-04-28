import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type {
  Channel,
  PriceWithChange,
  ChannelPrice,
  FailureWarning,
} from '@/types/database';
import {
  dateKeyKST,
  daysAgoKeyKST,
  startOfDayKstISO,
  endOfDayKstISO,
} from '@/lib/date-utils';

export interface DashboardResponse {
  latest: PriceWithChange[];
  sparklines: Record<string, number[]>;
  lastCollectedAt: string | null;
}

type Supabase = ReturnType<typeof createServiceClient>;

/**
 * 대시보드 메인 화면용 통합 라우트.
 * 기존에 분리되어 있던 latest / sparkline / last-collected 3개 호출을
 * 단일 라우트에서 Promise.all로 동시 실행해 RTT를 1회로 줄인다.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.max(2, Math.min(parseInt(searchParams.get('days') || '7', 10), 30));
    const brandIdsParam = searchParams.get('brand_ids');

    const supabase = createServiceClient();

    let prodQuery = supabase
      .from('products')
      .select('*, brand:brands(id, name)')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (brandIdsParam) {
      const ids = brandIdsParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length > 0) prodQuery = prodQuery.in('brand_id', ids);
    }
    const { data: products, error: prodError } = await prodQuery;

    if (prodError) {
      return NextResponse.json({ error: prodError.message }, { status: 500 });
    }

    if (!products || products.length === 0) {
      const empty: DashboardResponse = { latest: [], sparklines: {}, lastCollectedAt: null };
      return NextResponse.json(empty);
    }

    const productIds = products.map((p) => p.id);

    const [latest, sparklines, lastCollectedAt] = await Promise.all([
      buildLatest(supabase, products, productIds),
      buildSparklines(supabase, productIds, days),
      buildLastCollectedAt(supabase),
    ]);

    const body: DashboardResponse = { latest, sparklines, lastCollectedAt };
    return NextResponse.json(body);
  } catch (err) {
    console.error('[api/dashboard]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function buildLatest(
  supabase: Supabase,
  products: Array<{
    id: string;
    name: string;
    sabangnet_code: string | null;
    brand_id: string | null;
    brand?: { id: string; name: string } | null;
    coupang_url: string | null;
    naver_url: string | null;
    danawa_url: string | null;
  }>,
  productIds: string[]
): Promise<PriceWithChange[]> {
  const todayStr = dateKeyKST();
  const yesterdayStr = daysAgoKeyKST(1);

  const { data: logs, error: logError } = await supabase
    .from('price_logs')
    .select('*')
    .in('product_id', productIds)
    .eq('is_suspicious', false)
    .gte('collected_at', startOfDayKstISO(yesterdayStr))
    .lte('collected_at', endOfDayKstISO(todayStr))
    .order('collected_at', { ascending: false });

  if (logError) throw new Error(logError.message);

  const channels: Channel[] = ['coupang', 'naver', 'danawa'];

  type LogRow = NonNullable<typeof logs>[number];
  const logIndex = new Map<string, LogRow[]>();
  for (const log of logs ?? []) {
    const key = `${log.product_id}:${log.channel}`;
    const arr = logIndex.get(key);
    if (arr) arr.push(log);
    else logIndex.set(key, [log]);
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // (product_id, channel) 그룹별 최근 10건만 받는 RPC. 상품 수가 늘어도 누락 없음.
  // RPC 미적용 환경에서는 fallback으로 limit 쿼리 사용.
  type ErrorRow = { product_id: string; channel: string; created_at: string };
  let recentErrors: ErrorRow[] = [];
  const { data: rpcRows, error: rpcErr } = await supabase.rpc('recent_failures_per_channel', {
    p_since: sevenDaysAgo,
    p_product_ids: productIds,
    p_per_group: 10,
  });
  if (!rpcErr && Array.isArray(rpcRows)) {
    recentErrors = rpcRows as ErrorRow[];
  } else {
    const { data: fallback } = await supabase
      .from('scrape_errors')
      .select('product_id, channel, created_at')
      .in('product_id', productIds)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(2000);
    recentErrors = (fallback ?? []) as ErrorRow[];
  }

  const failureMap = new Map<string, number>();
  if (recentErrors) {
    const grouped = new Map<string, string[]>();
    for (const err of recentErrors) {
      const key = `${err.product_id}:${err.channel}`;
      const arr = grouped.get(key);
      if (arr) arr.push(err.created_at as string);
      else grouped.set(key, [err.created_at as string]);
    }

    for (const [key, timestamps] of grouped) {
      const latestSuccess = logIndex.get(key)?.[0];
      const latestSuccessTime = latestSuccess
        ? new Date(latestSuccess.collected_at).getTime()
        : 0;
      let consecutiveErrors = 0;
      for (const t of timestamps) {
        if (new Date(t).getTime() > latestSuccessTime) consecutiveErrors++;
      }
      if (consecutiveErrors >= 3) {
        failureMap.set(key, consecutiveErrors);
      }
    }
  }

  return products.map((product) => {
    const prices: ChannelPrice[] = channels.map((channel) => {
      const channelLogs = logIndex.get(`${product.id}:${channel}`) ?? [];

      let todayLog: LogRow | undefined;
      let yesterdayLog: LogRow | undefined;
      for (const l of channelLogs) {
        const key = dateKeyKST(l.collected_at);
        if (!todayLog && key === todayStr) todayLog = l;
        else if (!yesterdayLog && key === yesterdayStr) yesterdayLog = l;
        if (todayLog && yesterdayLog) break;
      }

      let change: number | null = null;
      if (todayLog && yesterdayLog) {
        change = todayLog.price - yesterdayLog.price;
      }

      return {
        channel,
        price: todayLog?.price ?? yesterdayLog?.price ?? 0,
        store_name: todayLog?.store_name ?? yesterdayLog?.store_name ?? null,
        change,
      };
    });

    const warnings: FailureWarning[] = [];
    for (const channel of channels) {
      const key = `${product.id}:${channel}`;
      const count = failureMap.get(key);
      if (count && count >= 3) {
        warnings.push({
          product_id: product.id,
          channel,
          consecutive_failures: count,
        });
      }
    }

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
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  });
}

async function buildSparklines(
  supabase: Supabase,
  productIds: string[],
  days: number
): Promise<Record<string, number[]>> {
  const sinceKey = daysAgoKeyKST(days - 1);

  const { data: logs, error: logError } = await supabase
    .from('price_logs')
    .select('product_id, price, collected_at')
    .in('product_id', productIds)
    .eq('is_suspicious', false)
    .gte('collected_at', startOfDayKstISO(sinceKey));

  if (logError) throw new Error(logError.message);

  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dayKeys.push(daysAgoKeyKST(i));
  }

  const grouped = new Map<string, Map<string, number>>();
  for (const log of logs ?? []) {
    const day = dateKeyKST(log.collected_at as string);
    if (!grouped.has(log.product_id)) grouped.set(log.product_id, new Map());
    const dayMap = grouped.get(log.product_id)!;
    const prev = dayMap.get(day);
    if (prev === undefined || (log.price as number) < prev) {
      dayMap.set(day, log.price as number);
    }
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
