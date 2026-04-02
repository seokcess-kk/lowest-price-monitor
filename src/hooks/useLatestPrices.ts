import { useState, useEffect, useCallback } from 'react';
import type { PriceWithChange } from '@/types/database';

export function useLatestPrices() {
  const [data, setData] = useState<PriceWithChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/prices/latest');
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || '최신 가격을 불러오지 못했습니다.');
      }
      const result: PriceWithChange[] = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLatest();
  }, [fetchLatest]);

  return { data, loading, error, refetch: fetchLatest };
}
