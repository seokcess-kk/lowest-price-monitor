import type { Channel } from '@/types/database';
import { createServiceClient } from '@/lib/supabase';

export interface UnlockerResult {
  ok: boolean;
  status: number;
  text: string | null;
  bytes: number;
  durationMs: number;
}

interface UsageRow {
  channel: Channel;
  status_code: number | null;
  success: boolean;
  response_bytes: number | null;
  duration_ms: number;
}

// 모듈 레벨 누적 버퍼 — collectAll 한 사이클에서 호출이 끝나면 flush
const buffer: UsageRow[] = [];

export function recordUsage(row: UsageRow): void {
  buffer.push(row);
}

export async function flushUsage(): Promise<void> {
  if (buffer.length === 0) return;
  const rows = buffer.splice(0, buffer.length);
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from('brightdata_usage_logs').insert(rows);
    if (error) {
      // 일시적 DB 오류로 사용량 텔레메트리가 통째로 사라지지 않도록 버퍼 앞쪽에 되돌려
      // 다음 flush(상품 단위 또는 종료 시 최종 flush)에서 재시도되게 한다.
      buffer.unshift(...rows);
      console.error(`[brightdata] usage flush 실패 — 재버퍼링: ${error.message}`);
    }
  } catch (err) {
    buffer.unshift(...rows);
    console.error('[brightdata] usage flush 예외 — 재버퍼링:', err);
  }
}

/**
 * Bright Data Web Unlocker API 호출 wrapper.
 * 모든 호출에 대해 호출 시각/채널/status/응답 바이트/소요시간을 in-memory 버퍼에 기록한다.
 * collectAll 종료 시 flushUsage()로 bulk insert.
 */
export async function callWebUnlocker(opts: {
  channel: Channel;
  url: string;
  country?: string;
  /** 이 호출의 최대 대기 시간(ms). 미지정 시 기본 60초. 쿠팡은 재시도 예산에 맞춰 조정해 호출한다. */
  timeoutMs?: number;
}): Promise<UnlockerResult> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const zone = process.env.BRIGHTDATA_ZONE;

  if (!token || !zone) {
    throw new Error(
      'BRIGHTDATA_API_TOKEN / BRIGHTDATA_ZONE 환경 변수가 설정되지 않았습니다'
    );
  }

  const start = Date.now();
  let status = 0;
  let text: string | null = null;
  let bytes = 0;
  let ok = false;

  // 한 호출이 무한 hang 시 전체 수집이 묶이는 것을 방지.
  // 쿠팡은 봇 우회 부담으로 30~50초 걸리는 경우가 흔해 기본 60초로 둔다.
  // 호출자가 timeoutMs를 주면(쿠팡 재시도 예산) 그 값을 우선한다.
  const REQUEST_TIMEOUT_MS = opts.timeoutMs ?? 60_000;

  try {
    const res = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        zone,
        url: opts.url,
        format: 'raw',
        country: opts.country ?? 'kr',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    status = res.status;
    try {
      text = await res.text();
    } catch {
      text = null;
    }
    bytes = text ? new TextEncoder().encode(text).length : 0;
    ok = res.ok;
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      console.warn(`[brightdata] ${opts.channel} 요청 ${REQUEST_TIMEOUT_MS}ms 초과로 중단`);
      // 정상 처리 흐름(ok=false)으로 흘려보내 상위 채널 파서가 null 반환 + scrape_errors 기록
    } else {
      throw err;
    }
  } finally {
    const durationMs = Date.now() - start;
    recordUsage({
      channel: opts.channel,
      status_code: status || null,
      success: ok,
      response_bytes: bytes || null,
      duration_ms: durationMs,
    });
  }

  return { ok, status, text, bytes, durationMs: Date.now() - start };
}
