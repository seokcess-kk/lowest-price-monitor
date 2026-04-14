import { collectAll } from '../src/scraper';
import { createServiceClient } from '../src/lib/supabase';

/**
 * 가격 수집 스크립트.
 *
 * - 단순 실행: 모든 활성 상품에 대해 collectAll()을 호출하고 결과를 출력
 * - COLLECT_REQUEST_ID 환경변수가 있으면 collect_requests row 상태도 함께 업데이트
 *   (대시보드 "즉시 수집" 버튼에서 트리거된 워크플로우용)
 */
async function main(): Promise<void> {
  const requestId = process.env.COLLECT_REQUEST_ID || null;
  const supabase = requestId ? createServiceClient() : null;

  if (supabase && requestId) {
    await supabase
      .from('collect_requests')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', requestId);
  }

  console.log('가격 수집 시작...');

  try {
    const result = await collectAll({
      isManual: !!requestId,
      onProgress:
        supabase && requestId
          ? async (done, total) => {
              await supabase
                .from('collect_requests')
                .update({ progress_done: done, progress_total: total })
                .eq('id', requestId);
            }
          : undefined,
    });
    console.log(`수집 완료: ${result.success}건 성공, ${result.failed}건 실패`);
    if (result.errors.length > 0) {
      console.error('에러:', result.errors);
    }

    if (supabase && requestId) {
      await supabase
        .from('collect_requests')
        .update({
          status: 'completed',
          result_success: result.success,
          result_failed: result.failed,
          error_message: result.errors.length > 0 ? result.errors.join('\n') : null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', requestId);
    }

    if (result.failed > 0 && result.success === 0) {
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('수집 실패:', message);

    if (supabase && requestId) {
      await supabase
        .from('collect_requests')
        .update({
          status: 'failed',
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', requestId);
    }

    process.exit(1);
  }
}

main();
