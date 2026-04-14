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
      console.error(`[brightdata] usage flush 실패: ${error.message}`);
    }
  } catch (err) {
    console.error('[brightdata] usage flush 예외:', err);
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
    });

    status = res.status;
    try {
      text = await res.text();
    } catch {
      text = null;
    }
    bytes = text ? new TextEncoder().encode(text).length : 0;
    ok = res.ok;
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
