import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { Channel } from '@/types/database';

export interface ErrorGroupRow {
  product_id: string;
  product_name: string;
  brand_name: string | null;
  channel: Channel;
  consecutive_failures: number;
  last_failure_at: string;
  last_failure_message: string;
  last_success_at: string | null;
}

interface RawErrorRow {
  id: string;
  product_id: string;
  channel: string;
  error_message: string;
  created_at: string;
  products: {
    name: string;
    brand: { name: string } | null;
  } | null;
}

interface RawSuccessRow {
  product_id: string;
  channel: string;
  collected_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);

    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const productId = searchParams.get('product_id');
    const groupBy = searchParams.get('group_by') === 'product_channel' ? 'group' : 'flat';

    if (groupBy === 'flat') {
      let query = supabase
        .from('scrape_errors')
        .select('*, products(name, brand:brands(name))')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (productId) {
        query = query.eq('product_id', productId);
      }

      const { data, error } = await query;

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const result = (data || []).map((row) => {
        const r = row as unknown as RawErrorRow;
        return {
          id: r.id,
          product_id: r.product_id,
          product_name: r.products?.name ?? '알 수 없음',
          brand_name: r.products?.brand?.name ?? null,
          channel: r.channel,
          error_message: r.error_message,
          created_at: r.created_at,
        };
      });

      return NextResponse.json(result);
    }

    // group_by=product_channel: 최근 14일 내 에러를 (product, channel) 단위로 묶고
    // 마지막 성공 시각까지 join.
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    let errQuery = supabase
      .from('scrape_errors')
      .select('id, product_id, channel, error_message, created_at, products(name, brand:brands(name))')
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (productId) errQuery = errQuery.eq('product_id', productId);
    const { data: errs, error: errErr } = await errQuery;

    if (errErr) {
      return NextResponse.json({ error: errErr.message }, { status: 500 });
    }

    const groups = new Map<
      string,
      {
        product_id: string;
        product_name: string;
        brand_name: string | null;
        channel: Channel;
        latest_failure: RawErrorRow | null;
        failure_count: number;
        failure_times: string[];
      }
    >();

    for (const row of errs ?? []) {
      const r = row as unknown as RawErrorRow;
      const key = `${r.product_id}:${r.channel}`;
      const existing = groups.get(key);
      if (existing) {
        existing.failure_count++;
        existing.failure_times.push(r.created_at);
      } else {
        groups.set(key, {
          product_id: r.product_id,
          product_name: r.products?.name ?? '알 수 없음',
          brand_name: r.products?.brand?.name ?? null,
          channel: r.channel as Channel,
          latest_failure: r,
          failure_count: 1,
          failure_times: [r.created_at],
        });
      }
    }

    if (groups.size === 0) {
      return NextResponse.json([]);
    }

    // 그룹 단위로 마지막 성공 시각 조회 — (product_id, channel) 쌍을 OR 결합
    const productIds = Array.from(new Set([...groups.values()].map((g) => g.product_id)));
    const { data: successes } = await supabase
      .from('price_logs')
      .select('product_id, channel, collected_at')
      .in('product_id', productIds)
      .order('collected_at', { ascending: false });

    const lastSuccess = new Map<string, string>();
    for (const row of successes ?? []) {
      const r = row as unknown as RawSuccessRow;
      const key = `${r.product_id}:${r.channel}`;
      if (!lastSuccess.has(key)) lastSuccess.set(key, r.collected_at);
    }

    // 마지막 성공 이후의 실패만 카운트 (연속 실패 정의)
    const result: ErrorGroupRow[] = [];
    for (const [key, g] of groups) {
      const lastSuccessAt = lastSuccess.get(key) ?? null;
      const successTime = lastSuccessAt ? new Date(lastSuccessAt).getTime() : 0;
      const consecutive = g.failure_times.filter(
        (t) => new Date(t).getTime() > successTime
      ).length;
      result.push({
        product_id: g.product_id,
        product_name: g.product_name,
        brand_name: g.brand_name,
        channel: g.channel,
        consecutive_failures: consecutive,
        last_failure_at: g.latest_failure?.created_at ?? '',
        last_failure_message: g.latest_failure?.error_message ?? '',
        last_success_at: lastSuccessAt,
      });
    }

    result.sort((a, b) => b.consecutive_failures - a.consecutive_failures);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/errors]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
