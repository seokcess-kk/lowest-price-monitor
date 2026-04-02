import { useState, useEffect, useCallback } from 'react';
import type { Product } from '@/types/database';

export function useProducts(activeOnly: boolean = false) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products?active_only=${activeOnly}`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || '상품 목록을 불러오지 못했습니다.');
      }
      const data: Product[] = await res.json();
      setProducts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }, [activeOnly]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  return { products, loading, error, refetch: fetchProducts };
}
