import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * Bright Data 공식 사용량 통계를 동기화한다.
 *
 * 엔드포인트는 플랜/계정에 따라 다를 수 있으므로 환경 변수로 주입한다.
 *   BRIGHTDATA_STATS_URL — full URL (예: https://api.brightdata.com/zone/statistic?zone=...&from=...&to=...)
 *   BRIGHTDATA_API_TOKEN — Authorization Bearer 토큰
 *
 * 응답 JSON은 raw 그대로 brightdata_stats_snapshots.raw_response 컬럼에 저장하고,
 * 흔히 쓰이는 필드(요청수/대역폭)는 best-effort로 추출.
 */
export async function POST(req: NextRequest) {
  try {
    const token = process.env.BRIGHTDATA_API_TOKEN;
    const statsUrlTemplate = process.env.BRIGHTDATA_STATS_URL;

    if (!token) {
      return NextResponse.json(
        { error: 'BRIGHTDATA_API_TOKEN 미설정' },
        { status: 400 }
      );
    }
    if (!statsUrlTemplate) {
      return NextResponse.json(
        {
          error:
            'BRIGHTDATA_STATS_URL 미설정. Bright Data 콘솔에서 zone 통계 API URL을 확인 후 환경 변수에 등록하세요. 예: https://api.brightdata.com/zone/statistic?zone=ZONE&from={from}&to={to}',
        },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({} as Record<string, string>));
    const today = new Date().toISOString().split('T')[0];
    const monthStart = `${today.slice(0, 7)}-01`;
    const from = body.from || monthStart;
    const to = body.to || today;

    // {from} {to} 토큰 치환 + 쿼리스트링 폴백
    let statsUrl = statsUrlTemplate.replace('{from}', from).replace('{to}', to);
    if (!statsUrl.includes('from=') && !statsUrl.includes('{from}')) {
      const sep = statsUrl.includes('?') ? '&' : '?';
      statsUrl = `${statsUrl}${sep}from=${from}&to=${to}`;
    }

    const res = await fetch(statsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `Bright Data stats API ${res.status}: ${text.slice(0, 500)}` },
        { status: 502 }
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: '응답이 JSON이 아닙니다', preview: text.slice(0, 500) },
        { status: 502 }
      );
    }

    // best-effort 추출 — 응답 스키마가 다양하므로 여러 키 후보 시도
    const requestCount = pickNumber(raw, [
      'requests',
      'request_count',
      'total_requests',
      'reqs',
      'count',
    ]);
    const bandwidthBytes = pickNumber(raw, [
      'bw',
      'bandwidth',
      'bytes',
      'traffic_bytes',
      'total_bytes',
    ]);

    const supabase = createServiceClient();
    const { error: insertError } = await supabase.from('brightdata_stats_snapshots').insert({
      period_start: from,
      period_end: to,
      request_count: requestCount,
      bandwidth_bytes: bandwidthBytes,
      raw_response: raw as object,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      period: { from, to },
      requestCount,
      bandwidthBytes,
    });
  } catch (err) {
    console.error('[api/brightdata/sync]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  // 최근 스냅샷 1건 + 우리 카운트 비교
  try {
    const supabase = createServiceClient();
    const { data: snapshots, error: snapErr } = await supabase
      .from('brightdata_stats_snapshots')
      .select('*')
      .order('fetched_at', { ascending: false })
      .limit(1);

    if (snapErr) {
      return NextResponse.json({ error: snapErr.message }, { status: 500 });
    }

    const latest = snapshots?.[0] ?? null;
    if (!latest) {
      return NextResponse.json({ latest: null, localCount: null, drift: null });
    }

    const startTs = new Date(latest.period_start as string).toISOString();
    const endTs = new Date(`${latest.period_end as string}T23:59:59.999Z`).toISOString();
    const { count: localCount, error: countErr } = await supabase
      .from('brightdata_usage_logs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startTs)
      .lte('created_at', endTs);

    if (countErr) {
      return NextResponse.json({ error: countErr.message }, { status: 500 });
    }

    const remote = latest.request_count as number | null;
    const drift =
      remote !== null && localCount !== null && localCount !== undefined
        ? remote - localCount
        : null;

    return NextResponse.json({
      latest,
      localCount: localCount ?? 0,
      drift,
    });
  } catch (err) {
    console.error('[api/brightdata/sync GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function pickNumber(obj: unknown, keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    const found = deepFindNumber(obj as Record<string, unknown>, key);
    if (found !== null) return found;
  }
  return null;
}

function deepFindNumber(obj: Record<string, unknown>, key: string): number | null {
  for (const [k, v] of Object.entries(obj)) {
    if (k === key && typeof v === 'number') return v;
    if (k === key && typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    if (v && typeof v === 'object') {
      const nested = deepFindNumber(v as Record<string, unknown>, key);
      if (nested !== null) return nested;
    }
  }
  return null;
}
