import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase';
import ProductDetailClient from '@/components/ProductDetailClient';
import type { PriceLog, Product } from '@/types/database';

const INITIAL_PERIOD = '30d' as const;

function getInitialStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split('T')[0];
}

/**
 * 상품 상세 — 서버 컴포넌트.
 * product와 초기 30일치 price history를 Promise.all로 프리페치 후 클라이언트 컴포넌트에 전달.
 * 마운트 직후 두 번의 클라이언트 fetch를 기다리지 않도록 한다.
 */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceClient();

  const startDate = getInitialStartDate();

  const [productRes, historyRes] = await Promise.all([
    supabase.from('products').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('price_logs')
      .select('*')
      .eq('product_id', id)
      .eq('is_suspicious', false)
      .gte('collected_at', startDate)
      .order('collected_at', { ascending: false }),
  ]);

  if (productRes.error || !productRes.data) {
    notFound();
  }

  const product = productRes.data as Product;
  const initialHistory = (historyRes.data ?? []) as PriceLog[];

  return (
    <ProductDetailClient
      productId={id}
      initialProduct={product}
      initialPeriod={INITIAL_PERIOD}
      initialHistory={initialHistory}
    />
  );
}
