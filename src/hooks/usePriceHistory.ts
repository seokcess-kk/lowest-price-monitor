import { useState, useEffect, useCallback, useRef } from 'react';
import type { PriceLog } from '@/types/database';

interface UsePriceHistoryOptions {
  channel?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

/**
 * 상품의 가격 이력을 조회한다.
 * initialData가 주어지면 첫 마운트의 fetch는 건너뛰고 그 값을 그대로 사용 (서버 프리페치 결과 재사용).
 * options가 바뀌면(기간 토글 등) 클라이언트에서 다시 fetch.
 */
export function usePriceHistory(
  productId: string | null,
  options: UsePriceHistoryOptions = {},
  initialData?: PriceLog[]
) {
  const [data, setData] = useState<PriceLog[]>(initialData ?? []);
  const [loading, setLoading] = useState<boolean>(initialData ? false : true);
  const [error, setError] = useState<string | null>(null);
  // 서버에서 받은 초기 데이터가 있을 때 첫 effect 호출 1회만 스킵
  const skipFirstFetchRef = useRef<boolean>(!!initialData);

  const fetchHistory = useCallback(async () => {
    if (!productId) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ product_id: productId });
      if (options.channel) params.set('channel', options.channel);
      if (options.startDate) params.set('start_date', options.startDate);
      if (options.endDate) params.set('end_date', options.endDate);
      if (options.limit) params.set('limit', String(options.limit));

      const res = await fetch(`/api/prices?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || '가격 이력을 불러오지 못했습니다.');
      }
      const result: PriceLog[] = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }, [productId, options.channel, options.startDate, options.endDate, options.limit]);

  useEffect(() => {
    if (skipFirstFetchRef.current) {
      skipFirstFetchRef.current = false;
      return;
    }
    fetchHistory();
  }, [fetchHistory]);

  return { data, loading, error, refetch: fetchHistory };
}
