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

/**
 * zone 장애(전 채널 200+빈 본문) 런타임 서킷브레이커.
 *
 * 배경: zone 과금/한도 문제가 나면 대상 사이트와 무관하게 모든 호출이 200+빈 본문으로
 * 일관되게 돌아온다(실측 2026-07). 기존 장애 감지(zone_outage_windows RPC)는 다음 실행의
 * 백오프 카운트에서 사후 제외할 뿐이라, 장애가 진행 중인 그 실행에서는 채널당 수천 건이
 * 데이터 없이 계속 과금된다(정상일 하루 ~1,600건 → 장애일 ~5,000건).
 *
 * 그래서 실행 중에 채널별 "연속 무효 응답"을 세다가 임계를 넘으면 그 채널을 이번 실행 동안
 * 차단(trip)해 이후 호출을 실제 fetch 없이 즉시 단락시킨다 — 과금을 막는다.
 * 유효 응답(본문이 최소 크기 이상)이 한 번이라도 오면 카운터를 리셋하므로, 정상 채널은
 * 쿠팡 상시 빈 응답(~35%)이 섞여도 연속 임계에 도달하지 않아 트립되지 않는다.
 */
const OUTAGE_EMPTY_BYTES = 1_000;
// 연속 무효 응답이 이 횟수를 넘으면 채널 차단. zone_outage_windows RPC의 OUTAGE_MIN_CALLS(20)와 정합.
// 정상 채널에서 연속 20회 무효는 확률적으로 사실상 나오지 않는다(쿠팡 35% 가정 시 0.35^20 ≈ 10^-9).
const OUTAGE_TRIP_THRESHOLD = 20;

interface BreakerState {
  consecutiveEmpty: number;
  tripped: boolean;
}
const breakers = new Map<Channel, BreakerState>();

function getBreaker(channel: Channel): BreakerState {
  let state = breakers.get(channel);
  if (!state) {
    state = { consecutiveEmpty: 0, tripped: false };
    breakers.set(channel, state);
  }
  return state;
}

/** collectAll 시작 시 호출 — 이전 실행/사이클의 트립 상태가 새 실행으로 새지 않도록. */
export function resetCircuitBreakers(): void {
  breakers.clear();
}

/** 이 채널이 이번 실행에서 zone 장애로 차단됐는지 — 오케스트레이터가 호출 자체를 건너뛰는 데 쓴다. */
export function isCircuitTripped(channel: Channel): boolean {
  return getBreaker(channel).tripped;
}

/** 관측성: 이번 실행에서 차단된 채널 목록. */
export function trippedChannels(): Channel[] {
  return [...breakers.entries()].filter(([, s]) => s.tripped).map(([c]) => c);
}

/** fetch 응답 크기로 서킷브레이커 카운터를 갱신하고, 방금 트립됐으면 true 반환(경고 로그용). */
function recordBreakerOutcome(channel: Channel, bytes: number): boolean {
  const state = getBreaker(channel);
  if (state.tripped) return false;
  if (bytes >= OUTAGE_EMPTY_BYTES) {
    state.consecutiveEmpty = 0;
    return false;
  }
  state.consecutiveEmpty++;
  if (state.consecutiveEmpty >= OUTAGE_TRIP_THRESHOLD) {
    state.tripped = true;
    return true;
  }
  return false;
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

  // zone 장애로 이미 차단된 채널이면 실제 호출을 건너뛴다 — 과금 방지.
  // 오케스트레이터가 활성 채널에서 미리 제외하지만, 트립 직전 이미 진행 중이던 상품이나
  // 쿠팡 파서의 남은 재시도가 여기로 들어오므로 호출 지점에서 한 번 더 막는다.
  if (isCircuitTripped(opts.channel)) {
    recordUsage({
      channel: opts.channel,
      status_code: null,
      success: false,
      response_bytes: null,
      duration_ms: 0,
    });
    return { ok: false, status: 0, text: null, bytes: 0, durationMs: 0 };
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
    // 응답 크기로 서킷브레이커 갱신 — 타임아웃(bytes=0)도 무효로 세어 zone 장애를 빨리 잡는다.
    if (recordBreakerOutcome(opts.channel, bytes)) {
      console.warn(
        `[brightdata] ${opts.channel} 채널 zone 장애 감지 — 연속 무효 응답 ${OUTAGE_TRIP_THRESHOLD}회, ` +
          `이번 실행 남은 호출 차단(과금 방지)`
      );
    }
  }

  return { ok, status, text, bytes, durationMs: Date.now() - start };
}
