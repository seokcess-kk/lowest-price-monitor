import { useState, useEffect, useCallback, useRef } from 'react';

export interface Bucket {
  total: number;
  success: number;
  failed: number;
  bytes: number;
  avgDurationMs: number;
  estimatedCostUsd: number;
}

export interface ChannelBucket extends Bucket {
  channel: string;
}

export interface DailyBucket extends Bucket {
  date: string;
}

export interface UsageResponse {
  pricing: {
    currency: string;
    billableMetric: 'successful_requests';
    cpmUsd: number;
    includedRequests: number;
    monthlyCommitmentUsd: number;
  };
  today: Bucket;
  month: Bucket;
  projected: {
    total: number;
    success: number;
    failed: number;
    bytes: number;
    estimatedCostUsd: number;
    elapsedMonthRatio: number;
    periodStart: string;
    periodEnd: string;
    generatedAt: string;
  };
  byChannel: ChannelBucket[];
  daily: DailyBucket[];
  official: {
    byChannel: Array<{ channel: string; requests: number; estimatedCostUsd: number }>;
    totalRequests: number;
    estimatedCostUsd: number;
  } | null;
}

export interface SyncResponse {
  latest: {
    period_start: string;
    period_end: string;
    request_count: number | null;
    bandwidth_bytes: number | null;
    fetched_at: string;
  } | null;
  localCount: number | null;
  localSuccessCount: number | null;
  drift: number | null;
}

interface Snapshot {
  usage: UsageResponse;
  sync: SyncResponse | null;
}

const CACHE_TTL_MS = 30_000;

let cache: Snapshot | null = null;
let cachedAt = 0;
let inflight: Promise<Snapshot> | null = null;

async function fetchUsage(): Promise<Snapshot> {
  const [u, s] = await Promise.all([
    fetch('/api/brightdata/usage').then((r) => r.json()),
    fetch('/api/brightdata/sync').then((r) => r.json()),
  ]);
  if (u.error) throw new Error(u.error);
  // sync 실패는 치명적이지 않음 — 스냅샷 없이도 사용량 화면은 정상 동작
  return { usage: u as UsageResponse, sync: s.error ? null : (s as SyncResponse) };
}

/**
 * Bright Data 사용량 훅 — usage/sync 병렬 조회 + 모듈 레벨 SWR 캐시.
 * 페이지 재진입 시 stale 캐시를 즉시 표시하고 백그라운드로 revalidate한다.
 */
export function useBrightdataUsage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(cache);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const revalidate = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && cache && now - cachedAt < CACHE_TTL_MS) {
      return;
    }

    if (!inflight) {
      inflight = fetchUsage()
        .then((next) => {
          cache = next;
          cachedAt = Date.now();
          return next;
        })
        .finally(() => {
          inflight = null;
        });
    }

    try {
      const next = await inflight;
      if (!mountedRef.current) return;
      setSnapshot(next);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : '로드 실패');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (cache) {
      setSnapshot(cache);
      setLoading(false);
    }
    revalidate(false);
    return () => {
      mountedRef.current = false;
    };
  }, [revalidate]);

  const refetch = useCallback(() => {
    setLoading(!cache);
    return revalidate(true);
  }, [revalidate]);

  return {
    usage: snapshot?.usage ?? null,
    sync: snapshot?.sync ?? null,
    loading,
    error,
    refetch,
  };
}
