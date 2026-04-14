import { useState, useEffect, useCallback } from 'react';

/**
 * price_logs의 가장 최근 수집 시각을 가져온다.
 * refreshKey가 바뀌면 재조회 (수집 완료 시점에 갱신 트리거용).
 */
export function useLastCollected(refreshKey?: number | string) {
  const [at, setAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchIt = useCallback(async () => {
    try {
      const res = await fetch('/api/prices/last-collected');
      if (!res.ok) return;
      const json: { at: string | null } = await res.json();
      setAt(json.at);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIt();
  }, [fetchIt, refreshKey]);

  return { at, loading, refetch: fetchIt };
}
