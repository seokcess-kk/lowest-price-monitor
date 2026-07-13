import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ProductFacets,
  ProductListResponse,
  ProductOpsFilter,
  ProductSortKey,
  ProductStatusFilter,
  SortDirection,
} from '@/types/database';

const CACHE_TTL_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 300;

export interface ProductListQuery {
  page: number;
  pageSize?: number;
  q?: string;
  status?: ProductStatusFilter;
  brandIds?: string[];
  ops?: ProductOpsFilter;
  sort?: ProductSortKey;
  dir?: SortDirection;
  /** 관리 화면처럼 절대값 카운트(필터 칩)가 필요한 곳만 true */
  includeFacets?: boolean;
}

interface CacheEntry {
  data: ProductListResponse | null;
  cachedAt: number;
  inflight: Promise<ProductListResponse> | null;
}

// 쿼리 직렬화 키별 캐시. 페이지 재진입 시 즉시 stale 결과 노출 후 백그라운드 갱신.
const cache = new Map<string, CacheEntry>();

function getEntry(key: string): CacheEntry {
  let entry = cache.get(key);
  if (!entry) {
    entry = { data: null, cachedAt: 0, inflight: null };
    cache.set(key, entry);
  }
  return entry;
}

function buildSearchParams(query: ProductListQuery, q: string): string {
  const params = new URLSearchParams();
  params.set('page', String(Math.max(1, query.page)));
  params.set('page_size', String(query.pageSize ?? 50));
  if (q.trim()) params.set('q', q.trim());
  if (query.status && query.status !== 'all') params.set('status', query.status);
  if (query.brandIds && query.brandIds.length > 0) {
    params.set('brand_ids', query.brandIds.join(','));
  }
  if (query.ops && query.ops !== 'none') params.set('ops', query.ops);
  if (query.sort && query.sort !== 'created') params.set('sort', query.sort);
  if (query.dir) params.set('dir', query.dir);
  if (query.includeFacets) params.set('include_facets', 'true');
  return params.toString();
}

async function fetchProductList(qs: string): Promise<ProductListResponse> {
  const res = await fetch(`/api/products?${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '상품 목록을 불러오지 못했습니다.');
  }
  return (await res.json()) as ProductListResponse;
}

/** 검색 타이핑마다 서버를 치지 않도록 지연시킨 값 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

/**
 * 서버 페이지네이션 상품 목록 훅.
 * 이전 useProducts(전체 로드 후 클라이언트 필터)를 대체 — 상품 5,000개 규모에서
 * 전체 로드는 payload 수 MB + 1,000행 절단 문제가 있어 서버 필터/페이지로 전환.
 */
export function useProductList(query: ProductListQuery) {
  const debouncedQ = useDebouncedValue(query.q ?? '', SEARCH_DEBOUNCE_MS);
  const key = buildSearchParams(query, debouncedQ);

  const initialEntry = getEntry(key);
  const [data, setData] = useState<ProductListResponse | null>(initialEntry.data);
  const [loading, setLoading] = useState<boolean>(initialEntry.cachedAt === 0);
  const [error, setError] = useState<string | null>(null);
  // 페이지/필터가 바뀌어도 마지막 facets를 유지해 칩 깜빡임 방지
  const [facets, setFacets] = useState<ProductFacets | null>(
    initialEntry.data?.facets ?? null
  );
  const mountedRef = useRef(true);

  const revalidate = useCallback(
    async (force: boolean) => {
      const entry = getEntry(key);
      const now = Date.now();
      if (!force && entry.cachedAt > 0 && now - entry.cachedAt < CACHE_TTL_MS) {
        return;
      }

      if (!entry.inflight) {
        entry.inflight = fetchProductList(key)
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
        setData(next);
        if (next.facets) setFacets(next.facets);
        setError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : '알 수 없는 오류');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [key]
  );

  useEffect(() => {
    mountedRef.current = true;
    const entry = getEntry(key);
    if (entry.cachedAt > 0 && entry.data) {
      // stale 캐시 즉시 표시 + 백그라운드 갱신
      setData(entry.data);
      if (entry.data.facets) setFacets(entry.data.facets);
      setLoading(false);
    } else {
      setLoading(true);
    }
    revalidate(false);
    return () => {
      mountedRef.current = false;
    };
  }, [key, revalidate]);

  // 뮤테이션 후 재조회 — 전체 키 캐시를 무효화해 다른 페이지/필터 조합도 다음 진입 시 갱신
  const refetch = useCallback(() => {
    for (const entry of cache.values()) {
      entry.cachedAt = 0;
    }
    setLoading(getEntry(key).data === null);
    return revalidate(true);
  }, [key, revalidate]);

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? query.page,
    pageSize: data?.page_size ?? query.pageSize ?? 50,
    facets,
    loading,
    error,
    refetch,
  };
}
