import { collectAll } from '../src/scraper';
import { createServiceClient } from '../src/lib/supabase';
import { dateKeyKST, daysAgoKeyKST } from '../src/lib/date-utils';

/**
 * 가격 수집 스크립트 (GitHub Actions 샤드 1개 = 이 스크립트 1회 실행).
 *
 * - 단순 실행: 모든 활성 상품에 대해 collectAll()을 호출하고 결과를 출력
 * - COLLECT_REQUEST_ID: collect_requests row 상태를 함께 갱신 (대시보드/크론 진행률)
 * - COLLECT_PRODUCT_ID: 그 상품 하나만 수집 (상품별 즉시 수집 버튼)
 * - SHARD_INDEX / SHARD_TOTAL: matrix 샤드 좌표 (기본 0/1 = 단일 실행)
 * - COLLECT_TRIGGER_SOURCE: 'cron'이면 requestId가 있어도 저빈도 게이트를 유지
 *   (isManual은 "사용자가 버튼으로 요청했는가"의 의미 — 크론은 수동이 아니다)
 *
 * 진행률/완료 갱신은 016 마이그레이션의 원자적 RPC를 사용한다. 여러 샤드가 같은 row를
 * 동시에 갱신해도 경합이 없다. RPC 미적용 환경에서는 기존 직접 UPDATE로 폴백
 * (그 환경에서는 샤딩도 없으므로 단일 작성자라 안전).
 */
async function main(): Promise<void> {
  const requestId = process.env.COLLECT_REQUEST_ID || null;
  const productId = process.env.COLLECT_PRODUCT_ID || null;
  const triggerSource = process.env.COLLECT_TRIGGER_SOURCE || null;
  const shardIndex = Math.max(0, parseInt(process.env.SHARD_INDEX || '0', 10) || 0);
  const shardTotal = Math.max(1, parseInt(process.env.SHARD_TOTAL || '1', 10) || 1);
  // soft deadline (기본 5h15m) — collect job timeout(5h45m)보다 30분 앞서 정상 마무리
  const deadlineMinutes = Math.max(
    5,
    parseInt(process.env.COLLECT_DEADLINE_MINUTES || '315', 10) || 315
  );
  const supabase = requestId ? createServiceClient() : null;
  const startedAtMs = Date.now();
  const deadlineMs = startedAtMs + deadlineMinutes * 60_000;

  // 배치 수집: collect_requests row 에 저장된 product_ids 를 읽어 그 상품들만 수집
  let batchProductIds: string[] | null = null;
  if (supabase && requestId) {
    const { data: reqRow } = await supabase
      .from('collect_requests')
      .select('product_ids')
      .eq('id', requestId)
      .single();
    const ids = (reqRow?.product_ids ?? null) as string[] | null;
    if (Array.isArray(ids) && ids.length > 0) {
      batchProductIds = ids;
    }
  }

  // 우선순위: 단일 상품(env) > 배치(row.product_ids) > 전역(undefined)
  const targetProductIds = productId
    ? [productId]
    : batchProductIds ?? undefined;

  console.log(
    productId
      ? `가격 수집 시작 (단일 상품 ${productId})...`
      : batchProductIds
        ? `가격 수집 시작 (배치 ${batchProductIds.length}개 상품, 샤드 ${shardIndex + 1}/${shardTotal})...`
        : `가격 수집 시작 (샤드 ${shardIndex + 1}/${shardTotal})...`
  );

  // RPC가 없는 환경(016 미적용)이 감지되면 이후 호출은 기존 직접 UPDATE로 폴백
  let rpcUnavailable = false;
  let lastDone = 0;

  const reportProgress = async (done: number, total: number): Promise<void> => {
    if (!supabase || !requestId) return;

    if (rpcUnavailable) {
      // 폴백: 단일 작성자 전제의 기존 절대값 UPDATE (샤딩 없는 환경)
      await supabase
        .from('collect_requests')
        .update({
          status: 'running',
          started_at: new Date(startedAtMs).toISOString(),
          progress_done: done,
          progress_total: total,
        })
        .eq('id', requestId);
      return;
    }

    if (done === 0) {
      // 샤드 시작 신고: pending→running 전환 + 이 샤드 몫을 progress_total에 가산
      const { error } = await supabase.rpc('start_collect_shard', {
        p_request_id: requestId,
        p_shards_total: shardTotal,
        p_progress_total_inc: total,
      });
      if (error) {
        console.warn(`[collect] start_collect_shard RPC 실패 — 직접 UPDATE 폴백: ${error.message}`);
        rpcUnavailable = true;
        await reportProgress(done, total);
      }
    } else {
      const inc = done - lastDone;
      const { error } = await supabase.rpc('increment_collect_progress', {
        p_request_id: requestId,
        p_inc: inc,
      });
      if (error) {
        console.warn(`[collect] increment_collect_progress RPC 실패 — 직접 UPDATE 폴백: ${error.message}`);
        rpcUnavailable = true;
        await reportProgress(done, total);
        return;
      }
    }
    lastDone = done;
  };

  try {
    const result = await collectAll({
      // 크론(전역/샤드)은 requestId가 있어도 수동이 아니다 — 저빈도 차등 게이트 유지
      isManual: !!requestId && triggerSource !== 'cron',
      productIds: targetProductIds,
      onProgress: supabase && requestId ? reportProgress : undefined,
      shard: shardTotal > 1 ? { index: shardIndex, total: shardTotal } : undefined,
      deadlineMs,
    });
    console.log(`수집 완료: ${result.success}건 성공, ${result.failed}건 실패`);
    if (result.errors.length > 0) {
      console.error('에러:', result.errors);
    }

    // 샤드 종료 신고 — 마지막 샤드(allDone)만 mark_outliers 등 전역 후처리를 1회 실행
    let allDone = true;
    if (supabase && requestId) {
      const durationS = Math.round((Date.now() - startedAtMs) / 1000);
      if (!rpcUnavailable) {
        const { data, error } = await supabase.rpc('finalize_collect_shard', {
          p_request_id: requestId,
          p_success: result.success,
          p_failed: result.failed,
          p_error: result.errors.length > 0 ? result.errors.join('\n') : null,
          p_shard_stat: {
            shard: shardIndex,
            success: result.success,
            failed: result.failed,
            duration_s: durationS,
            ...(result.deadlineHit
              ? { deadline_hit: true, unprocessed: result.unprocessed }
              : {}),
          },
        });
        if (error) {
          console.warn(`[collect] finalize_collect_shard RPC 실패 — 직접 UPDATE 폴백: ${error.message}`);
          rpcUnavailable = true;
        } else {
          allDone = data === true;
        }
      }
      if (rpcUnavailable) {
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
    }

    if (allDone) {
      // 수집 직후 이상치 자동 마킹 — 차트·KPI에 즉시 반영.
      // RPC 미적용 환경에서는 무해하게 skip.
      try {
        const sb = supabase ?? createServiceClient();
        const { data: flagged, error: rpcErr } = await sb.rpc('mark_outliers', {
          p_window_days: 30,
          p_min_samples: 5,
          p_mad_threshold: 6.0,
          p_ratio_threshold: 0.5,
        });
        if (rpcErr) {
          console.warn(`[mark_outliers] skip: ${rpcErr.message}`);
        } else {
          console.log(`[mark_outliers] ${flagged ?? 0}건 의심 마킹`);
          // 이상치 마킹이 과거 30일 로그의 is_suspicious를 플립하므로
          // 같은 윈도우의 일별 요약을 재계산해 반영한다.
          const { error: refreshErr } = await sb.rpc('refresh_price_daily', {
            p_from: daysAgoKeyKST(30),
            p_to: dateKeyKST(),
          });
          if (refreshErr) {
            console.warn(`[refresh_price_daily] skip: ${refreshErr.message}`);
          }
        }
      } catch (e) {
        console.warn('[mark_outliers] 예외:', e);
      }
    } else {
      console.log(`[collect] 샤드 ${shardIndex + 1}/${shardTotal} 완료 — 전역 후처리는 마지막 샤드가 실행`);
    }

    if (result.failed > 0 && result.success === 0) {
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('수집 실패:', message);

    if (supabase && requestId) {
      const durationS = Math.round((Date.now() - startedAtMs) / 1000);
      let finalized = false;
      if (!rpcUnavailable) {
        // 샤드 하나의 실패로 전체 요청을 failed로 만들지 않는다 — 다른 샤드는 계속 돈다.
        // 대신 에러를 집계에 남기고, 마지막 샤드였는데 성공이 전무하면 failed로 강등.
        const { data: allDoneOnError, error } = await supabase.rpc('finalize_collect_shard', {
          p_request_id: requestId,
          p_success: 0,
          p_failed: 0,
          p_error: `[샤드 ${shardIndex + 1}/${shardTotal}] ${message}`,
          p_shard_stat: {
            shard: shardIndex,
            error: message,
            duration_s: durationS,
          },
        });
        if (!error) {
          finalized = true;
          if (allDoneOnError === true) {
            const { data: row } = await supabase
              .from('collect_requests')
              .select('result_success')
              .eq('id', requestId)
              .single();
            if (((row?.result_success as number | null) ?? 0) === 0) {
              await supabase
                .from('collect_requests')
                .update({ status: 'failed' })
                .eq('id', requestId);
            }
          }
        }
      }
      if (!finalized) {
        await supabase
          .from('collect_requests')
          .update({
            status: 'failed',
            error_message: message,
            completed_at: new Date().toISOString(),
          })
          .eq('id', requestId);
      }
    }

    process.exit(1);
  }
}

main();
