import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

interface UsageRow {
  channel: string;
  status_code: number | null;
  success: boolean;
  response_bytes: number | null;
  duration_ms: number;
  created_at: string;
}

interface BucketStats {
  total: number;
  success: number;
  failed: number;
  bytes: number;
  avgDurationMs: number;
}

function summarize(rows: UsageRow[]): BucketStats {
  if (rows.length === 0) {
    return { total: 0, success: 0, failed: 0, bytes: 0, avgDurationMs: 0 };
  }
  let success = 0;
  let bytes = 0;
  let durationSum = 0;
  for (const r of rows) {
    if (r.success) success += 1;
    bytes += r.response_bytes ?? 0;
    durationSum += r.duration_ms;
  }
  return {
    total: rows.length,
    success,
    failed: rows.length - success,
    bytes,
    avgDurationMs: Math.round(durationSum / rows.length),
  };
}

export async function GET() {
  try {
    const supabase = createServiceClient();
    const now = new Date();

    // KST 자정 기준
    const kstOffsetMs = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffsetMs);
    const kstTodayStart = new Date(
      Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate())
    );
    const todayStartUtc = new Date(kstTodayStart.getTime() - kstOffsetMs);
    const monthStartKst = new Date(
      Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), 1)
    );
    const monthStartUtc = new Date(monthStartKst.getTime() - kstOffsetMs);

    const { data, error } = await supabase
      .from('brightdata_usage_logs')
      .select('channel, status_code, success, response_bytes, duration_ms, created_at')
      .gte('created_at', monthStartUtc.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as UsageRow[];
    const todayRows = rows.filter((r) => new Date(r.created_at) >= todayStartUtc);

    const today = summarize(todayRows);
    const month = summarize(rows);

    // 채널별 (이번 달)
    const byChannelMap = new Map<string, UsageRow[]>();
    for (const r of rows) {
      const list = byChannelMap.get(r.channel) ?? [];
      list.push(r);
      byChannelMap.set(r.channel, list);
    }
    const byChannel = Array.from(byChannelMap.entries())
      .map(([channel, list]) => ({ channel, ...summarize(list) }))
      .sort((a, b) => b.total - a.total);

    // 일별 추이 (최근 14일)
    const dailyMap = new Map<string, UsageRow[]>();
    for (const r of rows) {
      const kstDate = new Date(new Date(r.created_at).getTime() + kstOffsetMs)
        .toISOString()
        .split('T')[0];
      const list = dailyMap.get(kstDate) ?? [];
      list.push(r);
      dailyMap.set(kstDate, list);
    }
    const daily = Array.from(dailyMap.entries())
      .map(([date, list]) => ({ date, ...summarize(list) }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);

    return NextResponse.json({ today, month, byChannel, daily });
  } catch (err) {
    console.error('[api/brightdata/usage]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
