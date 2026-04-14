import { useState, useEffect } from 'react';

export function useSparklines(days = 7) {
  const [data, setData] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/prices/sparkline?days=${days}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((json: Record<string, number[]>) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  return { data, loading };
}
