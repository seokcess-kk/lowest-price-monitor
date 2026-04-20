import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * 활성 상품들의 최근 N일 일별 최저가 추이를 반환한다.
 * 응답: { [productId]: number[] }  // 길이 N, 누락된 날은 그날 이전 마지막 값으로 forward-fill
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.max(2, Math.min(parseInt(searchParams.get('days') || '7', 10), 30));

    const supabase = createServiceClient();

    const { data: products, error: prodError } = await supabase
      .from('products')
      .select('id')
      .eq('is_active', true);

    if (prodError) {
      return NextResponse.json({ error: prodError.message }, { status: 500 });
    }
    if (!products || products.length === 0) {
      return NextResponse.json({});
    }

    const productIds = products.map((p) => p.id);

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    const { data: logs, error: logError } = await supabase
      .from('price_logs')
      .select('product_id, price, collected_at')
      .in('product_id', productIds)
      .eq('is_suspicious', false)
      .gte('collected_at', since.toISOString());

    if (logError) {
      return NextResponse.json({ error: logError.message }, { status: 500 });
    }

    // dayKey 배열 (오늘까지 N일)
    const dayKeys: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      dayKeys.push(d.toISOString().split('T')[0]);
    }

    // product_id -> dayKey -> minPrice
    const grouped = new Map<string, Map<string, number>>();
    for (const log of logs ?? []) {
      const day = (log.collected_at as string).split('T')[0];
      if (!grouped.has(log.product_id)) grouped.set(log.product_id, new Map());
      const dayMap = grouped.get(log.product_id)!;
      const prev = dayMap.get(day);
      if (prev === undefined || (log.price as number) < prev) {
        dayMap.set(day, log.price as number);
      }
    }

    const result: Record<string, number[]> = {};
    for (const pid of productIds) {
      const dayMap = grouped.get(pid);
      const arr: number[] = [];
      let lastSeen: number | null = null;
      for (const dayKey of dayKeys) {
        const v = dayMap?.get(dayKey);
        if (v !== undefined) {
          lastSeen = v;
          arr.push(v);
        } else if (lastSeen !== null) {
          arr.push(lastSeen);
        }
      }
      // 데이터가 2개 미만이면 빈 배열 (sparkline placeholder 표시)
      result[pid] = arr.length >= 2 ? arr : [];
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
