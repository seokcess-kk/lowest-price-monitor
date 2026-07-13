import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { chunkArray, selectAllRange, selectByIdChunks } from '@/lib/query-chunk';
import { dateKeyKST } from '@/lib/date-utils';
import type { ExportRequest, ExportRow } from '@/types/database';

// 5,000상품 × 장기간 조회는 오래 걸릴 수 있다 (Vercel Pro 이상에서 실효)
export const maxDuration = 300;

/** price_logs 원본 보존 개월 수 — purge_old_data(019)의 기본값과 일치해야 한다 */
const RAW_RETENTION_MONTHS = 6;
/** daily 모드 응답 행 상한 — 초과 시 기간을 좁혀 달라고 안내 */
const DAILY_MAX_ROWS = 300_000;

/** 원본(raw) 조회 가능한 가장 이른 KST 일자 */
function rawCutoffKey(): string {
  const kst = new Date(Date.now() + 9 * 3600_000);
  kst.setUTCMonth(kst.getUTCMonth() - RAW_RETENTION_MONTHS);
  return kst.toISOString().split('T')[0];
}

function isDateKey(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

type DailyRow = {
  date: string;
  channel: string;
  min_price: number | null;
  min_store_name: string | null;
  product: {
    name: string;
    sabangnet_code: string | null;
    brand: { name: string } | null;
  } | null;
};

function sortRows(rows: ExportRow[]): ExportRow[] {
  return rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.productName !== b.productName) return a.productName.localeCompare(b.productName);
    return a.channel.localeCompare(b.channel);
  });
}

/**
 * Export 데이터 조회.
 *
 * GET → POST 전환 이유: product_ids 수천 개를 쿼리스트링에 직렬화하면 URL 길이
 * 한도(PostgREST 이전에 브라우저/프록시에서)로 깨진다. body로 받는다.
 *
 * - mode 'daily': price_daily 요약 조회 — 원본 보존 기간과 무관하게 전 기간 지원
 * - mode 'raw'  : price_logs 원본 — 보존 기간(6개월) 이내만. 그 이전은 daily 모드 안내
 */
export async function POST(request: NextRequest) {
  try {
    let body: ExportRequest;
    try {
      body = (await request.json()) as ExportRequest;
    } catch {
      return NextResponse.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
    }

    const { start_date: startDate, end_date: endDate } = body;
    if (!isDateKey(startDate) || !isDateKey(endDate)) {
      return NextResponse.json(
        { error: 'start_date와 end_date는 YYYY-MM-DD 형식으로 필수입니다.' },
        { status: 400 }
      );
    }
    const mode = body.mode === 'daily' ? 'daily' : 'raw';
    const includeSuspicious = body.include_suspicious === true;
    const countOnly = body.count_only === true;

    const supabase = createServiceClient();

    // brand 필터는 products 테이블 기준이라 사전 조회로 product_id를 좁힌다
    let resolvedProductIds: string[] | null = null;
    if (!body.product_ids?.length && body.brand_ids?.length) {
      const brandIds = body.brand_ids.map((s) => s.trim()).filter(Boolean);
      if (brandIds.length > 0) {
        const filteredProducts = await selectAllRange<{ id: string }>((from, to) =>
          supabase
            .from('products')
            .select('id')
            .in('brand_id', brandIds)
            .order('id')
            .range(from, to)
        );
        resolvedProductIds = filteredProducts.map((p) => p.id);
        if (resolvedProductIds.length === 0) {
          return NextResponse.json(countOnly ? { rawCount: 0, mode } : []);
        }
      }
    }

    const targetIds: string[] | null = body.product_ids?.length
      ? Array.from(new Set(body.product_ids.filter((x) => typeof x === 'string' && x)))
      : resolvedProductIds;

    if (mode === 'daily') {
      return await handleDaily(supabase, { startDate, endDate, targetIds, countOnly });
    }

    // raw 모드: 보존 기간 밖 요청 차단
    const cutoff = rawCutoffKey();
    if (startDate < cutoff) {
      return NextResponse.json(
        {
          error:
            `원본 수집 로그는 최근 ${RAW_RETENTION_MONTHS}개월(${cutoff} 이후)만 보관됩니다. ` +
            `그 이전 기간은 "일별 최저가 요약" 모드를 사용하세요.`,
        },
        { status: 400 }
      );
    }

    if (countOnly) {
      let count = 0;
      if (targetIds) {
        for (const chunk of chunkArray(targetIds, 100)) {
          let q = supabase
            .from('price_logs')
            .select('id', { count: 'exact', head: true })
            .in('product_id', chunk)
            .gte('collected_at', startDate)
            .lte('collected_at', endDate + 'T23:59:59.999Z');
          if (!includeSuspicious) q = q.eq('is_suspicious', false);
          const { count: c, error } = await q;
          if (error) return NextResponse.json({ error: error.message }, { status: 500 });
          count += c ?? 0;
        }
      } else {
        let q = supabase
          .from('price_logs')
          .select('id', { count: 'exact', head: true })
          .gte('collected_at', startDate)
          .lte('collected_at', endDate + 'T23:59:59.999Z');
        if (!includeSuspicious) q = q.eq('is_suspicious', false);
        const { count: c, error } = await q;
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        count = c ?? 0;
      }
      return NextResponse.json({ rawCount: count, mode });
    }

    // 기간이 길면 1,000행(Supabase 기본 상한)에서 조용히 잘리므로 range/청크 루프로 전량 조회
    type LogRow = Record<string, unknown>;
    let data: LogRow[];
    try {
      if (targetIds) {
        data = await selectByIdChunks<LogRow>(targetIds, (ids, from, to) => {
          let q = supabase
            .from('price_logs')
            .select('*, products(name, sabangnet_code, brand:brands(name))')
            .in('product_id', ids)
            .gte('collected_at', startDate)
            .lte('collected_at', endDate + 'T23:59:59.999Z')
            .order('collected_at', { ascending: true })
            .order('id', { ascending: true });
          if (!includeSuspicious) q = q.eq('is_suspicious', false);
          return q.range(from, to);
        });
      } else {
        data = await selectAllRange<LogRow>((from, to) => {
          let q = supabase
            .from('price_logs')
            .select('*, products(name, sabangnet_code, brand:brands(name))')
            .gte('collected_at', startDate)
            .lte('collected_at', endDate + 'T23:59:59.999Z')
            .order('collected_at', { ascending: true })
            .order('id', { ascending: true });
          if (!includeSuspicious) q = q.eq('is_suspicious', false);
          return q.range(from, to);
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '가격 이력 조회 실패';
      return NextResponse.json({ error: message }, { status: 500 });
    }

    // 청크 분할 조회는 전역 시간순이 깨지므로 다시 정렬
    data.sort((a, b) => String(a.collected_at).localeCompare(String(b.collected_at)));

    const rows: ExportRow[] = data.map((row) => {
      const products = row.products as
        | { name: string; sabangnet_code: string | null; brand: { name: string } | null }
        | null;
      return {
        date: dateKeyKST(row.collected_at as string),
        productName: products?.name || '',
        sabangnetCode: products?.sabangnet_code ?? null,
        brandName: products?.brand?.name ?? null,
        channel: row.channel as string,
        price: row.price as number,
        storeName: (row.store_name as string) || null,
      };
    });

    return NextResponse.json(rows);
  } catch (err) {
    console.error('[api/export]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** daily 모드 — price_daily 요약 조회 (기간 무제한, 정상 로그의 일 최저가) */
async function handleDaily(
  supabase: ReturnType<typeof createServiceClient>,
  opts: {
    startDate: string;
    endDate: string;
    targetIds: string[] | null;
    countOnly: boolean;
  }
) {
  const { startDate, endDate, targetIds, countOnly } = opts;

  // count는 정확·저렴 (요약 테이블이라 행 수 자체가 작다)
  let count = 0;
  if (targetIds) {
    for (const chunk of chunkArray(targetIds, 100)) {
      const { count: c, error } = await supabase
        .from('price_daily')
        .select('product_id', { count: 'exact', head: true })
        .in('product_id', chunk)
        .gte('date', startDate)
        .lte('date', endDate)
        .not('min_price', 'is', null);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      count += c ?? 0;
    }
  } else {
    const { count: c, error } = await supabase
      .from('price_daily')
      .select('product_id', { count: 'exact', head: true })
      .gte('date', startDate)
      .lte('date', endDate)
      .not('min_price', 'is', null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    count = c ?? 0;
  }

  if (countOnly) {
    return NextResponse.json({ rawCount: count, mode: 'daily' });
  }
  if (count > DAILY_MAX_ROWS) {
    return NextResponse.json(
      {
        error: `요약 행이 ${count.toLocaleString()}건으로 너무 많습니다 (상한 ${DAILY_MAX_ROWS.toLocaleString()}). 기간이나 상품을 좁혀주세요.`,
      },
      { status: 413 }
    );
  }

  const select = 'date, channel, min_price, min_store_name, product:products(name, sabangnet_code, brand:brands(name))';
  let dailyRows: DailyRow[];
  try {
    if (targetIds) {
      dailyRows = await selectByIdChunks<DailyRow>(targetIds, (ids, from, to) =>
        supabase
          .from('price_daily')
          .select(select)
          .in('product_id', ids)
          .gte('date', startDate)
          .lte('date', endDate)
          .not('min_price', 'is', null)
          .order('date', { ascending: true })
          .order('product_id', { ascending: true })
          .order('channel', { ascending: true })
          .range(from, to)
      );
    } else {
      dailyRows = await selectAllRange<DailyRow>((from, to) =>
        supabase
          .from('price_daily')
          .select(select)
          .gte('date', startDate)
          .lte('date', endDate)
          .not('min_price', 'is', null)
          .order('date', { ascending: true })
          .order('product_id', { ascending: true })
          .order('channel', { ascending: true })
          .range(from, to)
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : '일별 요약 조회 실패';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const rows: ExportRow[] = dailyRows
    .filter((r) => r.min_price !== null)
    .map((r) => ({
      date: r.date,
      productName: r.product?.name || '',
      sabangnetCode: r.product?.sabangnet_code ?? null,
      brandName: r.product?.brand?.name ?? null,
      channel: r.channel,
      price: r.min_price as number,
      storeName: r.min_store_name,
    }));

  return NextResponse.json(sortRows(rows));
}
