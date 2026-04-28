import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * 가격 이력 이상치 자동 마킹 트리거.
 * mark_outliers RPC를 호출해 표본 충분한 (product, channel) 그룹의 이상치를
 * is_suspicious=true 로 표시. 차트·KPI는 자동으로 깨끗해진다.
 *
 * 수동 호출 또는 GitHub Actions cron에서 후처리로 호출.
 *
 * Query parameters (선택):
 *   window_days, min_samples, mad_threshold, ratio_threshold
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const windowDays = parseInt(searchParams.get('window_days') || '30', 10);
    const minSamples = parseInt(searchParams.get('min_samples') || '5', 10);
    const madThreshold = parseFloat(searchParams.get('mad_threshold') || '6');
    const ratioThreshold = parseFloat(searchParams.get('ratio_threshold') || '0.5');

    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('mark_outliers', {
      p_window_days: windowDays,
      p_min_samples: minSamples,
      p_mad_threshold: madThreshold,
      p_ratio_threshold: ratioThreshold,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      flagged: typeof data === 'number' ? data : 0,
      params: { windowDays, minSamples, madThreshold, ratioThreshold },
    });
  } catch (err) {
    console.error('[api/maintenance/mark-outliers]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
