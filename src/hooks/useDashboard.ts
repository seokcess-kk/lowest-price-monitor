import { useState, useEffect, useCallback, useRef } from 'react';
import type { DashboardResponse } from '@/app/api/dashboard/route';

const CACHE_TTL_MS = 30_000;

let cache: DashboardResponse | null = null;
let cachedAt = 0;
let inflight: Promise<DashboardResponse> | null = null;

async function fetchDashboard(days: number): Promise<DashboardResponse> {
  const res = await fetch(`/api/dashboard?days=${days}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '대시보드 데이터를 불러오지 못했습니다.');
  }
  return (await res.json()) as DashboardResponse;
}

/**
 * 메인 대시보드 훅 — 통합 라우트 1회 호출 + 모듈 레벨 SWR 캐시.
 * 페이지 재진입 시 stale 캐시를 즉시 표시하고 백그라운드로 revalidate한다.
 * TTL 내(30초) 재진입은 네트워크 호출 생략.
 */
export function useDashboard(days = 7) {
  const [data, setData] = useState<DashboardResponse | null>(cache);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const revalidate = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (!force && cache && now - cachedAt < CACHE_TTL_MS) {
        return;
      }

      if (!inflight) {
        inflight = fetchDashboard(days)
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
        setData(next);
        setError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : '알 수 없는 오류');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [days]
  );

  useEffect(() => {
    mountedRef.current = true;
    if (cache) {
      // stale 캐시 즉시 표시 + 백그라운드 갱신
      setData(cache);
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
    latest: data?.latest ?? [],
    sparklines: data?.sparklines ?? {},
    lastCollectedAt: data?.lastCollectedAt ?? null,
    loading,
    error,
    refetch,
  };
}
