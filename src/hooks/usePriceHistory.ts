import { useState, useEffect, useCallback } from 'react';
import type { PriceLog } from '@/types/database';

interface UsePriceHistoryOptions {
  channel?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export function usePriceHistory(productId: string | null, options: UsePriceHistoryOptions = {}) {
  const [data, setData] = useState<PriceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    fetchHistory();
  }, [fetchHistory]);

  return { data, loading, error, refetch: fetchHistory };
}
