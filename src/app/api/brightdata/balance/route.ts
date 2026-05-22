import { NextResponse } from 'next/server';

/**
 * Bright Data 계정 잔액 조회.
 * GET https://api.brightdata.com/customer/balance
 * 응답: { balance: number, pending_balance: number }  (단위: USD)
 *
 * DB에 저장하지 않고 매 요청마다 실시간 조회한다 — 잔액 추이 분석은 별도 요구가 없는 한 불필요.
 */
export async function GET() {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: 'BRIGHTDATA_API_TOKEN 미설정' },
      { status: 400 }
    );
  }

  try {
    const res = await fetch('https://api.brightdata.com/customer/balance', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `Bright Data balance API ${res.status}: ${text.slice(0, 500)}` },
        { status: 502 }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: '응답이 JSON이 아닙니다', preview: text.slice(0, 300) },
        { status: 502 }
      );
    }

    const obj = (parsed ?? {}) as Record<string, unknown>;
    const balance = typeof obj.balance === 'number' ? obj.balance : null;
    const pendingBalance =
      typeof obj.pending_balance === 'number' ? obj.pending_balance : null;

    return NextResponse.json({
      balance,
      pendingBalance,
      currency: 'USD',
      fetchedAt: new Date().toISOString(),
      raw: parsed,
    });
  } catch (err) {
    console.error('[api/brightdata/balance]', err);
    const message =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
        ? '잔액 조회 타임아웃 (15s)'
        : err instanceof Error
          ? err.message
          : '잔액 조회 실패';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
