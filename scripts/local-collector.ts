/**
 * 로컬 수집기 — PC에서 상시 실행
 *
 * Supabase의 collect_requests 테이블을 5초마다 폴링하여
 * pending 상태의 수집 요청을 처리한다.
 *
 * 쿠팡은 headless: false가 필수이므로 로컬에서만 수집 가능.
 *
 * 실행: npx tsx scripts/local-collector.ts
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { collectAll } from '../src/scraper';

// .env.local 로드
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const POLL_INTERVAL = 5000; // 5초

async function processPendingRequest(): Promise<boolean> {
  // pending 요청 조회
  const { data: request, error } = await supabase
    .from('collect_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error || !request) return false;

  console.log(`\n[${new Date().toLocaleString('ko-KR')}] 수집 요청 감지 (${request.id})`);

  // running으로 상태 변경
  await supabase
    .from('collect_requests')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', request.id);

  try {
    const result = await collectAll({ isManual: true });

    // completed로 상태 변경
    await supabase
      .from('collect_requests')
      .update({
        status: 'completed',
        result_success: result.success,
        result_failed: result.failed,
        error_message: result.errors.length > 0 ? result.errors.join('\n') : null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', request.id);

    console.log(`[완료] ${result.success}건 성공, ${result.failed}건 실패`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabase
      .from('collect_requests')
      .update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', request.id);

    console.error(`[실패] ${message}`);
  }

  return true;
}

async function main() {
  console.log('=== 로컬 수집기 시작 ===');
  console.log(`폴링 간격: ${POLL_INTERVAL / 1000}초`);
  console.log('대시보드에서 "즉시 수집" 버튼을 누르면 자동으로 수집을 시작합니다.');
  console.log('종료: Ctrl+C\n');

  // 시작 시 기존 pending 요청 정리 (서버 재시작 시)
  await supabase
    .from('collect_requests')
    .update({ status: 'failed', error_message: '수집기 재시작으로 취소됨', completed_at: new Date().toISOString() })
    .eq('status', 'running');

  while (true) {
    try {
      const processed = await processPendingRequest();
      if (!processed) {
        // 대기 중일 때는 조용히
        process.stdout.write('.');
      }
    } catch (err) {
      console.error('\n[폴링 에러]', err instanceof Error ? err.message : err);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch(console.error);
