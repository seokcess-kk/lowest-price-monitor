import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * 전체 price_logs에서 가장 최근 수집 시각을 반환한다.
 * cron/즉시수집/수동 실행 경로 모두 포함. 데이터가 없으면 null.
 */
export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('price_logs')
      .select('collected_at')
      .order('collected_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ at: data?.collected_at ?? null });
  } catch (err) {
    console.error('[api/prices/last-collected]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
