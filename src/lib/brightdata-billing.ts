import { createServiceClient } from './supabase';

/**
 * Bright Data Web Unlocker 과금 계산 공유 모듈.
 * /api/brightdata/usage(대시보드 표시)와 scripts/prepare-collect.ts(월 예산 가드)가 함께 쓴다.
 *
 * 신뢰 소스 우선순위:
 *  1. 공식 /domains/req API — 실제 과금 요청 수
 *  2. 로컬 brightdata_usage_logs의 success count — 빈 응답·차단 페이지(200 OK)까지 포함해
 *     실제 과금보다 과다 집계되므로, 예산 가드 용도로는 보수적이라 안전
 */

export function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface BrightdataPricing {
  currency: string;
  billableMetric: string;
  cpmUsd: number;
  includedRequests: number;
  monthlyCommitmentUsd: number;
}

export function getBrightdataPricing(): BrightdataPricing {
  return {
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
}

export function estimateIncrementalCost(
  successfulRequests: number,
  pricing: BrightdataPricing
): number {
  return (successfulRequests / 1000) * pricing.cpmUsd;
}

export function estimateMonthlyCost(
  successfulRequests: number,
  pricing: BrightdataPricing
): number {
  const billableOverage = Math.max(0, successfulRequests - pricing.includedRequests);
  const usageCost = (billableOverage / 1000) * pricing.cpmUsd;
  return pricing.monthlyCommitmentUsd + usageCost;
}

export interface OfficialChannelUsage {
  channel: string;
  requests: number;
  estimatedCostUsd: number;
}

export interface OfficialUsage {
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
 * Bright Data 공식 과금 요청 수(/domains/req)를 이번 달(UTC 버킷) 기준으로 조회.
 * 실패 시 null → 호출측이 로컬 usage_logs로 폴백.
 */
export async function fetchOfficialUsage(): Promise<OfficialUsage | null> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const zone = process.env.BRIGHTDATA_ZONE;
  if (!token || !zone) return null;

  const pricing = getBrightdataPricing();
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
      console.warn(`[brightdata-billing] official req ${res.status}`);
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
    console.warn('[brightdata-billing] official fetch failed', err);
    return null;
  }
}

export interface KstMonthBoundaries {
  todayStartUtc: Date;
  monthStartUtc: Date;
  nextMonthStartUtc: Date;
}

/** KST 기준 오늘 자정·이번 달 1일·다음 달 1일의 UTC 시각 */
export function kstMonthBoundaries(now: Date = new Date()): KstMonthBoundaries {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffsetMs);
  const kstTodayStart = new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate())
  );
  const monthStartKst = new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), 1)
  );
  const nextMonthStartKst = new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() + 1, 1)
  );
  return {
    todayStartUtc: new Date(kstTodayStart.getTime() - kstOffsetMs),
    monthStartUtc: new Date(monthStartKst.getTime() - kstOffsetMs),
    nextMonthStartUtc: new Date(nextMonthStartKst.getTime() - kstOffsetMs),
  };
}

/**
 * 로컬 usage 로그 기반 이번 달 성공 요청 수 (공식 API 실패 시 폴백).
 * head count라 행 상한과 무관.
 */
export async function countLocalMonthlySuccess(
  monthStartUtc: Date
): Promise<number | null> {
  try {
    const supabase = createServiceClient();
    const { count, error } = await supabase
      .from('brightdata_usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('success', true)
      .gte('created_at', monthStartUtc.toISOString());
    if (error) {
      console.warn(`[brightdata-billing] local count 실패: ${error.message}`);
      return null;
    }
    return count ?? 0;
  } catch (err) {
    console.warn('[brightdata-billing] local count 예외:', err);
    return null;
  }
}
