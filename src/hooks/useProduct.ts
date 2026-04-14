import { useState, useEffect } from 'react';
import type { Product } from '@/types/database';

export function useProduct(productId: string | null) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState<boolean>(!!productId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`/api/products/${productId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || '상품을 불러오지 못했습니다.');
        if (!cancelled) setProduct(json as Product);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : '알 수 없는 오류');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  return { product, loading, error };
}
