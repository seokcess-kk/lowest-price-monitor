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
    const zone = process.env.BRIGHTDATA_ZONE;

    if (!token) {
      return NextResponse.json(
        { error: 'BRIGHTDATA_API_TOKEN 미설정' },
        { status: 400 }
      );
    }
    if (!zone) {
      return NextResponse.json(
        { error: 'BRIGHTDATA_ZONE 미설정' },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({} as Record<string, string>));
    const today = new Date().toISOString().split('T')[0];
    const monthStart = `${today.slice(0, 7)}-01`;
    const from = body.from || monthStart;
    const to = body.to || today;

    const headers = { Authorization: `Bearer ${token}` };
    const qs = `from=${from}&to=${to}&zones=${zone}`;

    const [bwRes, reqRes] = await Promise.all([
      fetch(`https://api.brightdata.com/domains/bw?${qs}`, { headers }),
      fetch(`https://api.brightdata.com/domains/req?${qs}`, { headers }),
    ]);

    const bwText = await bwRes.text();
    const reqText = await reqRes.text();

    if (!bwRes.ok) {
      return NextResponse.json(
        { error: `Bright Data bw API ${bwRes.status}: ${bwText.slice(0, 500)}` },
        { status: 502 }
      );
    }
    if (!reqRes.ok) {
      return NextResponse.json(
        { error: `Bright Data req API ${reqRes.status}: ${reqText.slice(0, 500)}` },
        { status: 502 }
      );
    }

    let bwRaw: unknown;
    let reqRaw: unknown;
    try {
      bwRaw = JSON.parse(bwText);
      reqRaw = JSON.parse(reqText);
    } catch {
      return NextResponse.json(
        { error: '응답이 JSON이 아닙니다', bwPreview: bwText.slice(0, 300), reqPreview: reqText.slice(0, 300) },
        { status: 502 }
      );
    }

    const bandwidthBytes = sumAllNumbers(bwRaw);
    const requestCount = sumAllNumbers(reqRaw);

    const supabase = createServiceClient();
    const { error: insertError } = await supabase.from('brightdata_stats_snapshots').insert({
      period_start: from,
      period_end: to,
      request_count: requestCount || null,
      bandwidth_bytes: bandwidthBytes || null,
      raw_response: { bw: bwRaw, req: reqRaw },
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

/**
 * /domains/bw, /domains/req 응답은 도메인별 수치 맵 또는 중첩 객체.
 * 모든 숫자 리프를 합산해 전체 사용량을 구한다.
 */
function sumAllNumbers(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (Array.isArray(val)) return val.reduce<number>((s, v) => s + sumAllNumbers(v), 0);
  if (val && typeof val === 'object') {
    return Object.values(val as Record<string, unknown>).reduce<number>(
      (s, v) => s + sumAllNumbers(v),
      0
    );
  }
  return 0;
}
