import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { selectAllRange } from '@/lib/query-chunk';
import { startOfDayKstISO } from '@/lib/date-utils';
import type { PriceLog, PricePoint } from '@/types/database';

/** price_logs 원본 보존 개월 수 — purge_old_data(019)·api/export와 일치해야 한다 */
const RAW_RETENTION_MONTHS = 6;

/** 원본/요약 경계 KST 일자 — 이 날짜 이전은 price_daily 합성 행으로 응답 */
function rawCutoffKey(): string {
  const kst = new Date(Date.now() + 9 * 3600_000);
  kst.setUTCMonth(kst.getUTCMonth() - RAW_RETENTION_MONTHS);
  return kst.toISOString().split('T')[0];
}

/**
 * 단일 상품 가격 이력.
 *
 * 요청 구간이 원본 보존 경계(6개월)를 넘으면:
 *   - 경계 이후: price_logs 원본 (range 루프 — 'all' 기간 고밀도 데이터의 1,000행 절단 방지)
 *   - 경계 이전: price_daily를 PriceLog 호환 shape으로 합성 (source='daily', 하루 1행 정상 최저가)
 * 두 구간을 이어붙여 collected_at 내림차순으로 반환 — 기존 소비처(PriceChart 일별 최저 집계)와
 * 의미가 동일해 회귀가 없다.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('product_id');
    const channel = searchParams.get('channel');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const limit = searchParams.get('limit');

    if (!productId) {
      return NextResponse.json({ error: 'product_id는 필수입니다.' }, { status: 400 });
    }

    const includeSuspicious = searchParams.get('include_suspicious') === 'true';
    const supabase = createServiceClient();

    const cutoffKey = rawCutoffKey();
    const startKey = startDate ? startDate.slice(0, 10) : null;
    const needDaily = startKey === null || startKey < cutoffKey;

    // 원본 구간: 경계 이후만 (경계 이전 원본이 purge 전에 남아 있어도 요약과 중복되지 않도록)
    const rawSince = (() => {
      const boundaryIso = startOfDayKstISO(cutoffKey);
      if (!startDate) return boundaryIso;
      return startDate > boundaryIso ? startDate : boundaryIso;
    })();

    let rawRows: PricePoint[];
    try {
      rawRows = await selectAllRange<PricePoint>((from, to) => {
        let query = supabase
          .from('price_logs')
          .select('*')
          .eq('product_id', productId)
          .gte('collected_at', rawSince)
          .order('collected_at', { ascending: false })
          .order('id', { ascending: true });
        if (!includeSuspicious) query = query.eq('is_suspicious', false);
        if (channel) query = query.eq('channel', channel);
        if (endDate) query = query.lte('collected_at', endDate + 'T23:59:59.999Z');
        return query.range(from, to);
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : '가격 이력 조회 실패';
      return NextResponse.json({ error: message }, { status: 500 });
    }

    let dailyRows: PricePoint[] = [];
    if (needDaily) {
      try {
        type DailyRow = {
          product_id: string;
          channel: PriceLog['channel'];
          date: string;
          min_price: number | null;
          min_store_name: string | null;
        };
        const rows = await selectAllRange<DailyRow>((from, to) => {
          let query = supabase
            .from('price_daily')
            .select('product_id, channel, date, min_price, min_store_name')
            .eq('product_id', productId)
            .lt('date', cutoffKey)
            .not('min_price', 'is', null)
            .order('date', { ascending: false })
            .order('channel', { ascending: true });
          if (startKey) query = query.gte('date', startKey);
          if (endDate) query = query.lte('date', endDate.slice(0, 10));
          if (channel) query = query.eq('channel', channel);
          return query.range(from, to);
        });
        dailyRows = rows.map((r) => ({
          // 합성 행 — 그날 정오(KST)로 시각을 고정해 차트 시간축에 자연스럽게 배치
          id: `daily-${r.product_id}-${r.channel}-${r.date}`,
          product_id: r.product_id,
          channel: r.channel,
          price: r.min_price as number,
          store_name: r.min_store_name,
          collected_at: new Date(`${r.date}T12:00:00+09:00`).toISOString(),
          is_manual: false,
          is_suspicious: false,
          source: 'daily' as const,
        }));
      } catch (e) {
        // price_daily 미적용 환경 — 원본만으로 응답 (기존 동작)
        console.warn('[api/prices] price_daily 조회 실패 (원본만 응답):', e);
      }
    }

    // 원본(최신) 먼저 + 요약(과거) — 양쪽 다 내림차순이라 그대로 이어붙이면 전체 내림차순
    let merged: PricePoint[] = rawRows.concat(dailyRows);
    if (limit) {
      const n = parseInt(limit, 10);
      if (Number.isFinite(n) && n > 0) merged = merged.slice(0, n);
    }

    return NextResponse.json(merged);
  } catch (err) {
    console.error('[api/prices]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
