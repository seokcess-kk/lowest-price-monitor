import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

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
    estimatedCostUsd: estimateIncrementalCost(success),
  };
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const pricing = {
  currency: 'USD',
  billableMetric: 'successful_requests',
  cpmUsd: readNumberEnv('BRIGHTDATA_WEB_UNLOCKER_CPM_USD', 1.5),
  includedRequests: Math.round(
    readNumberEnv('BRIGHTDATA_WEB_UNLOCKER_INCLUDED_REQUESTS', 0)
  ),
  monthlyCommitmentUsd: readNumberEnv(
    'BRIGHTDATA_WEB_UNLOCKER_MONTHLY_COMMITMENT_USD',
    0
  ),
};

function estimateIncrementalCost(successfulRequests: number): number {
  return (successfulRequests / 1000) * pricing.cpmUsd;
}

function estimateMonthlyCost(successfulRequests: number): number {
  const billableOverage = Math.max(0, successfulRequests - pricing.includedRequests);
  const usageCost = (billableOverage / 1000) * pricing.cpmUsd;
  return pricing.monthlyCommitmentUsd + usageCost;
}

interface OfficialChannelUsage {
  channel: string;
  requests: number;
  estimatedCostUsd: number;
}

interface OfficialUsage {
  byChannel: OfficialChannelUsage[];
  totalRequests: number;
  estimatedCostUsd: number;
}

// Bright Data /domains/req 도메인 → 내부 채널. 네이버는 두 도메인으로 쪼개져 합산 필요.
function domainToChannel(domain: string): string | null {
  switch (domain) {
    case 'coupang.com':
      return 'coupang';
    case 'danawa.com':
      return 'danawa';
    case 'naver.com':
    case 'search.shopping.naver.com':
      return 'naver';
    default:
      return null;
  }
}

/**
 * Bright Data 공식 과금 요청 수(/domains/req)를 신뢰 소스로 조회.
 * 로컬 usage_logs의 success(res.ok)는 빈 응답·차단 페이지(200 OK)까지 포함해 실제 과금보다 과다하므로,
 * 비용 표시는 공식 API 값을 우선한다. 실패 시 null → 상위에서 로컬 폴백.
 *
 * from/to는 UTC 날짜 버킷(Bright Data req 스펙)이라 KST 월경계와 미세한 차이가 있으나 근사 허용.
 */
async function fetchOfficialUsage(): Promise<OfficialUsage | null> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const zone = process.env.BRIGHTDATA_ZONE;
  if (!token || !zone) return null;

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const from = `${yyyy}-${mm}-01`;
  const to = `${yyyy}-${mm}-${dd}`;

  try {
    const res = await fetch(
      `https://api.brightdata.com/domains/req?from=${from}&to=${to}&zones=${encodeURIComponent(zone)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
        cache: 'no-store',
      }
    );
    if (!res.ok) {
      console.warn(`[api/brightdata/usage] official req ${res.status}`);
      return null;
    }

    const parsed = (await res.json()) as unknown;
    // { <zone>: { <dateIso>: { <domain>: count } } }
    const perChannel = new Map<string, number>();
    const root = (parsed ?? {}) as Record<string, unknown>;
    for (const zoneVal of Object.values(root)) {
      if (!zoneVal || typeof zoneVal !== 'object') continue;
      for (const dateVal of Object.values(zoneVal as Record<string, unknown>)) {
        if (!dateVal || typeof dateVal !== 'object') continue;
        for (const [domain, count] of Object.entries(dateVal as Record<string, unknown>)) {
          const channel = domainToChannel(domain);
          if (!channel) continue;
          const n = typeof count === 'number' ? count : 0;
          perChannel.set(channel, (perChannel.get(channel) ?? 0) + n);
        }
      }
    }

    const byChannel: OfficialChannelUsage[] = Array.from(perChannel.entries())
      .map(([channel, requests]) => ({
        channel,
        requests,
        estimatedCostUsd: (requests / 1000) * pricing.cpmUsd,
      }))
      .sort((a, b) => b.requests - a.requests);
    const totalRequests = byChannel.reduce((sum, c) => sum + c.requests, 0);
    const estimatedCostUsd = (totalRequests / 1000) * pricing.cpmUsd;

    return { byChannel, totalRequests, estimatedCostUsd };
  } catch (err) {
    console.warn('[api/brightdata/usage] official fetch failed', err);
    return null;
  }
}

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

    // KST 자정 기준
    const kstOffsetMs = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffsetMs);
    const kstTodayStart = new Date(
      Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate())
    );
    const todayStartUtc = new Date(kstTodayStart.getTime() - kstOffsetMs);
    const monthStartKst = new Date(
      Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), 1)
    );
    const monthStartUtc = new Date(monthStartKst.getTime() - kstOffsetMs);
    const nextMonthStartKst = new Date(
      Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() + 1, 1)
    );
    const nextMonthStartUtc = new Date(nextMonthStartKst.getTime() - kstOffsetMs);

    const rows = await getMonthRows(monthStartUtc);
    const todayRows = rows.filter((r) => new Date(r.created_at) >= todayStartUtc);

    const today = summarize(todayRows);
    const month = summarize(rows);
    month.estimatedCostUsd = estimateMonthlyCost(month.success);
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
      estimatedCostUsd: estimateMonthlyCost(projectedSuccessfulRequests),
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
      const kstDate = new Date(new Date(r.created_at).getTime() + kstOffsetMs)
        .toISOString()
        .split('T')[0];
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
