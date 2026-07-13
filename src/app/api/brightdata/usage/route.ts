import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  estimateIncrementalCost,
  estimateMonthlyCost,
  fetchOfficialUsage,
  getBrightdataPricing,
  kstMonthBoundaries,
  type OfficialUsage,
} from '@/lib/brightdata-billing';
import { dateKeyKST } from '@/lib/date-utils';

interface UsageRow {
  channel: string;
  status_code: number | null;
  success: boolean;
  response_bytes: number | null;
  duration_ms: number;
  created_at: string;
}

interface BucketStats {
  total: number;
  success: number;
  failed: number;
  bytes: number;
  avgDurationMs: number;
  estimatedCostUsd: number;
}

function summarize(rows: UsageRow[]): BucketStats {
  if (rows.length === 0) {
    return {
      total: 0,
      success: 0,
      failed: 0,
      bytes: 0,
      avgDurationMs: 0,
      estimatedCostUsd: 0,
    };
  }
  let success = 0;
  let bytes = 0;
  let durationSum = 0;
  for (const r of rows) {
    if (r.success) success += 1;
    bytes += r.response_bytes ?? 0;
    durationSum += r.duration_ms;
  }
  return {
    total: rows.length,
    success,
    failed: rows.length - success,
    bytes,
    avgDurationMs: Math.round(durationSum / rows.length),
    estimatedCostUsd: estimateIncrementalCost(success, pricing),
  };
}

// 과금 계산·공식 사용량 조회는 예산 가드(scripts/prepare-collect.ts)와 공유 — src/lib/brightdata-billing.ts
const pricing = getBrightdataPricing();

// 외부 API 부담·레이트리밋 완화를 위한 모듈 레벨 캐시 (TTL 5분).
let officialCache: { data: OfficialUsage | null; at: number } | null = null;
const OFFICIAL_TTL_MS = 300_000;

async function getOfficialUsage(): Promise<OfficialUsage | null> {
  const now = Date.now();
  if (officialCache && now - officialCache.at < OFFICIAL_TTL_MS) {
    return officialCache.data;
  }
  const data = await fetchOfficialUsage();
  officialCache = { data, at: now };
  return data;
}

// 이번달 로그는 수만 행이라 Supabase 기본 1,000행 응답 제한에 걸린다.
// created_at 범위 기반이라 id 청크가 아닌 range 페이지네이션으로 전량 수집.
async function fetchMonthRows(monthStartUtc: Date): Promise<UsageRow[]> {
  const supabase = createServiceClient();
  const rows: UsageRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('brightdata_usage_logs')
      .select('channel, status_code, success, response_bytes, duration_ms, created_at')
      .gte('created_at', monthStartUtc.toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as UsageRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

// 부하 완화: 수만 행 전량 재조회를 GET마다 하지 않도록 모듈 레벨 캐시 (TTL 60초).
// 월 경계는 TTL 안에서 자연히 갱신되므로 별도 키 없이 스냅샷만 보관.
let localCache: { rows: UsageRow[]; at: number } | null = null;
const LOCAL_TTL_MS = 60_000;

async function getMonthRows(monthStartUtc: Date): Promise<UsageRow[]> {
  const now = Date.now();
  if (localCache && now - localCache.at < LOCAL_TTL_MS) {
    return localCache.rows;
  }
  const rows = await fetchMonthRows(monthStartUtc);
  localCache = { rows, at: now };
  return rows;
}

export async function GET() {
  try {
    const now = new Date();
    const { todayStartUtc, monthStartUtc, nextMonthStartUtc } = kstMonthBoundaries(now);

    const rows = await getMonthRows(monthStartUtc);
    const todayRows = rows.filter((r) => new Date(r.created_at) >= todayStartUtc);

    const today = summarize(todayRows);
    const month = summarize(rows);
    month.estimatedCostUsd = estimateMonthlyCost(month.success, pricing);
    const elapsedMonthMs = Math.max(1, now.getTime() - monthStartUtc.getTime());
    const totalMonthMs = Math.max(
      elapsedMonthMs,
      nextMonthStartUtc.getTime() - monthStartUtc.getTime()
    );
    const elapsedMonthRatio = Math.min(1, elapsedMonthMs / totalMonthMs);
    const projectedSuccessfulRequests =
      elapsedMonthRatio > 0 ? Math.round(month.success / elapsedMonthRatio) : month.success;
    const projectedBytes =
      elapsedMonthRatio > 0 ? Math.round(month.bytes / elapsedMonthRatio) : month.bytes;
    const projected = {
      total: elapsedMonthRatio > 0 ? Math.round(month.total / elapsedMonthRatio) : month.total,
      success: projectedSuccessfulRequests,
      failed: elapsedMonthRatio > 0 ? Math.round(month.failed / elapsedMonthRatio) : month.failed,
      bytes: projectedBytes,
      estimatedCostUsd: estimateMonthlyCost(projectedSuccessfulRequests, pricing),
      elapsedMonthRatio,
      periodStart: monthStartUtc.toISOString(),
      periodEnd: nextMonthStartUtc.toISOString(),
      generatedAt: now.toISOString(),
    };

    // 채널별 (이번 달)
    const byChannelMap = new Map<string, UsageRow[]>();
    for (const r of rows) {
      const list = byChannelMap.get(r.channel) ?? [];
      list.push(r);
      byChannelMap.set(r.channel, list);
    }
    const byChannel = Array.from(byChannelMap.entries())
      .map(([channel, list]) => ({ channel, ...summarize(list) }))
      .sort((a, b) => b.total - a.total);

    // 일별 추이 (최근 14일)
    const dailyMap = new Map<string, UsageRow[]>();
    for (const r of rows) {
      const kstDate = dateKeyKST(r.created_at);
      const list = dailyMap.get(kstDate) ?? [];
      list.push(r);
      dailyMap.set(kstDate, list);
    }
    const daily = Array.from(dailyMap.entries())
      .map(([date, list]) => ({ date, ...summarize(list) }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);

    const official = await getOfficialUsage();

    return NextResponse.json({
      pricing,
      today,
      month,
      projected,
      byChannel,
      daily,
      official,
    });
  } catch (err) {
    console.error('[api/brightdata/usage]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
