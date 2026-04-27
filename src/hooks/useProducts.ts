import { useState, useEffect, useCallback, useRef } from 'react';
import type { Product } from '@/types/database';

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  data: Product[];
  cachedAt: number;
  inflight: Promise<Product[]> | null;
}

// activeOnly 키별로 캐시를 분리. 페이지 재진입 시 즉시 stale 결과 노출 후 백그라운드 갱신.
const cache = new Map<string, CacheEntry>();

function getEntry(key: string): CacheEntry {
  let entry = cache.get(key);
  if (!entry) {
    entry = { data: [], cachedAt: 0, inflight: null };
    cache.set(key, entry);
  }
  return entry;
}

async function fetchProducts(activeOnly: boolean): Promise<Product[]> {
  const res = await fetch(`/api/products?active_only=${activeOnly}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '상품 목록을 불러오지 못했습니다.');
  }
  return (await res.json()) as Product[];
}

export function useProducts(activeOnly: boolean = false) {
  const key = String(activeOnly);
  const initialEntry = getEntry(key);
  const [products, setProducts] = useState<Product[]>(initialEntry.data);
  const [loading, setLoading] = useState<boolean>(initialEntry.cachedAt === 0);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const revalidate = useCallback(
    async (force: boolean) => {
      const entry = getEntry(key);
      const now = Date.now();
      if (!force && entry.cachedAt > 0 && now - entry.cachedAt < CACHE_TTL_MS) {
        return;
      }

      if (!entry.inflight) {
        entry.inflight = fetchProducts(activeOnly)
          .then((next) => {
            entry.data = next;
            entry.cachedAt = Date.now();
            return next;
          })
          .finally(() => {
            entry.inflight = null;
          });
      }

      try {
        const next = await entry.inflight;
        if (!mountedRef.current) return;
        setProducts(next);
        setError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : '알 수 없는 오류');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [activeOnly, key]
  );

  useEffect(() => {
    mountedRef.current = true;
    const entry = getEntry(key);
    if (entry.cachedAt > 0) {
      // stale 캐시 즉시 표시 + 백그라운드 갱신
      setProducts(entry.data);
      setLoading(false);
    }
    revalidate(false);
    return () => {
      mountedRef.current = false;
    };
  }, [key, revalidate]);

  const refetch = useCallback(() => {
    const entry = getEntry(key);
    setLoading(entry.cachedAt === 0);
    return revalidate(true);
  }, [key, revalidate]);

  return { products, loading, error, refetch };
}
