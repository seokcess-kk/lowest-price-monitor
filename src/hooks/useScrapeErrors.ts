import { useState, useEffect, useCallback, useRef } from 'react';
import type { Channel } from '@/types/database';

export interface ErrorGroupRow {
  product_id: string;
  product_name: string;
  brand_name: string | null;
  channel: Channel;
  consecutive_failures: number;
  last_failure_at: string;
  last_failure_message: string;
  last_success_at: string | null;
}

const CACHE_TTL_MS = 30_000;

let cache: ErrorGroupRow[] | null = null;
let cachedAt = 0;
let inflight: Promise<ErrorGroupRow[]> | null = null;

async function fetchErrors(): Promise<ErrorGroupRow[]> {
  const res = await fetch('/api/errors?group_by=product_channel');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '에러 로그를 불러오지 못했습니다.');
  }
  return (await res.json()) as ErrorGroupRow[];
}

/**
 * 수집 에러(상품×채널 그룹) 훅 — 모듈 레벨 SWR 캐시.
 * 페이지 재진입 시 stale 캐시를 즉시 표시하고 백그라운드로 revalidate한다.
 * TTL 내(30초) 재진입은 네트워크 호출 생략.
 */
export function useScrapeErrors() {
  const [rows, setRows] = useState<ErrorGroupRow[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const revalidate = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && cache && now - cachedAt < CACHE_TTL_MS) {
      return;
    }

    if (!inflight) {
      inflight = fetchErrors()
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
      setRows(next);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (cache) {
      setRows(cache);
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

  return { rows, loading, error, refetch };
}
