import { appendFileSync } from 'node:fs';
import { createServiceClient } from '../src/lib/supabase';
import {
  countLocalMonthlySuccess,
  estimateMonthlyCost,
  fetchOfficialUsage,
  getBrightdataPricing,
  kstMonthBoundaries,
  readNumberEnv,
} from '../src/lib/brightdata-billing';

/**
 * 수집 워크플로우 prepare job.
 *
 * collect job(matrix 샤드)이 뜨기 전에 한 번만 실행되어:
 *  1. collect_requests row 확보 — 크론이면 새로 생성(trigger_source='cron'),
 *     대시보드 dispatch(request_id)면 기존 row 로드
 *  2. 대상 상품 수 기준으로 샤드 수 산정: clamp(ceil(대상/625), 1, 8)
 *     (샤드당 625개 = 상품당 평균 57초 × 동시성 2로 약 5시간 — 6h job 한도 내)
 *  3. 월 예산 가드 판정 (hard cap → run 전체 skip / soft cap → 등급 주기 완화)
 *
 * GitHub outputs: request_id / shard_total / shard_json / skip / budget_mode / trigger_source
 */

/** 샤드 1개가 6시간 한도 내에 안전하게 처리할 수 있는 상품 수 (전량 수집일 기준) */
const TARGET_PER_SHARD = 625;
const MAX_SHARDS = 8;

function setOutput(key: string, value: string): void {
  console.log(`[prepare] output ${key}=${value}`);
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

function shardJson(shardTotal: number): string {
  return JSON.stringify(Array.from({ length: shardTotal }, (_, i) => i));
}

async function main(): Promise<void> {
  const inputRequestId = process.env.COLLECT_REQUEST_ID || null;
  const inputProductId = process.env.COLLECT_PRODUCT_ID || null;
  const supabase = createServiceClient();

  // 단일 상품 수동 dispatch — 샤딩·예산 가드 불필요
  if (inputProductId) {
    setOutput('request_id', inputRequestId ?? '');
    setOutput('trigger_source', 'product');
    setOutput('shard_total', '1');
    setOutput('shard_json', shardJson(1));
    setOutput('skip', 'false');
    setOutput('budget_mode', '');
    return;
  }

  let requestId: string;
  let triggerSource: 'cron' | 'dashboard';
  let targetCount: number;

  if (inputRequestId) {
    // 대시보드 전역/배치 버튼 dispatch — 기존 row 사용
    triggerSource = 'dashboard';
    requestId = inputRequestId;
    const { data: row, error } = await supabase
      .from('collect_requests')
      .select('id, product_ids')
      .eq('id', inputRequestId)
      .single();
    if (error || !row) {
      throw new Error(`collect_requests row 조회 실패 (${inputRequestId}): ${error?.message}`);
    }
    const ids = (row.product_ids ?? null) as string[] | null;
    if (Array.isArray(ids) && ids.length > 0) {
      targetCount = ids.length;
    } else {
      targetCount = await countActiveProducts(supabase);
    }
    // 관측성: 어떤 경로로 시작됐는지 남긴다 (016 미적용 환경이면 조용히 실패해도 무해)
    await supabase
      .from('collect_requests')
      .update({ trigger_source: 'dashboard' })
      .eq('id', inputRequestId);
  } else {
    // 크론 (또는 입력 없는 수동 dispatch — 크론과 동일 취급: 저빈도 게이트·예산 가드 적용)
    triggerSource = 'cron';
    targetCount = await countActiveProducts(supabase);

    const budget = await evaluateBudget();
    if (budget.skip) {
      // run 전체 skip — 사유를 row로 남겨 대시보드에서 확인 가능하게
      const { error } = await supabase.from('collect_requests').insert({
        status: 'completed',
        trigger_source: 'cron',
        progress_total: 0,
        progress_done: 0,
        error_message: budget.reason,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      if (error) {
        console.warn(`[prepare] 예산 skip 기록 실패: ${error.message}`);
      }
      console.log(`[prepare] ${budget.reason}`);
      setOutput('request_id', '');
      setOutput('trigger_source', 'cron');
      setOutput('shard_total', '0');
      setOutput('shard_json', '[]');
      setOutput('skip', 'true');
      setOutput('budget_mode', '');
      return;
    }

    const { data: created, error } = await supabase
      .from('collect_requests')
      .insert({
        status: 'pending',
        trigger_source: 'cron',
        progress_total: 0,
        progress_done: 0,
      })
      .select('id')
      .single();
    if (error || !created) {
      throw new Error(`크론 collect_requests row 생성 실패: ${error?.message}`);
    }
    requestId = created.id as string;

    if (budget.mode === 'degrade') {
      console.log(`[prepare] ${budget.reason}`);
    }
    setOutput('budget_mode', budget.mode);
    setOutput('request_id', requestId);
    setOutput('trigger_source', triggerSource);
    emitShardOutputs(targetCount);
    return;
  }

  setOutput('budget_mode', '');
  setOutput('request_id', requestId);
  setOutput('trigger_source', triggerSource);
  emitShardOutputs(targetCount);
}

function emitShardOutputs(targetCount: number): void {
  const shardTotal = Math.min(
    MAX_SHARDS,
    Math.max(1, Math.ceil(targetCount / TARGET_PER_SHARD))
  );
  console.log(`[prepare] 대상 상품 ${targetCount}개 → 샤드 ${shardTotal}개`);
  setOutput('shard_total', String(shardTotal));
  setOutput('shard_json', shardJson(shardTotal));
  setOutput('skip', 'false');
}

async function countActiveProducts(
  supabase: ReturnType<typeof createServiceClient>
): Promise<number> {
  const { count, error } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);
  if (error) {
    throw new Error(`활성 상품 수 조회 실패: ${error.message}`);
  }
  return count ?? 0;
}

interface BudgetVerdict {
  skip: boolean;
  mode: '' | 'degrade';
  reason: string;
}

/**
 * 월 예산 가드 (크론 전용 — 수동 dispatch·단일 상품은 사용자 명시 의사라 제외).
 *
 *  - hard cap (COLLECT_MONTHLY_BUDGET_USD, 기본 $400): 이번 달 실지출이 이미 초과
 *    → 이번 run 전체 skip. run 1회 오버슈트는 최대 ~$22 수준이라 상한이 실질 보장된다.
 *  - soft cap (COLLECT_SOFT_BUDGET_USD, 기본 $330): 월말 예상 지출이 초과
 *    → budget_mode='degrade' — collectAll이 등급 주기를 2배로 완화해 소각률 절반.
 *
 * 사용량은 공식 /domains/req 우선, 실패 시 로컬 usage 로그 success count 폴백
 * (로컬은 과다 집계라 가드 용도로 보수적 = 안전). 둘 다 실패하면 가드 없이 통과 —
 * 사용량을 모른다고 수집을 멈추는 것보다 하루치 비용이 낫다.
 */
async function evaluateBudget(): Promise<BudgetVerdict> {
  const hardCapUsd = readNumberEnv('COLLECT_MONTHLY_BUDGET_USD', 400);
  const softCapUsd = readNumberEnv('COLLECT_SOFT_BUDGET_USD', 330);
  if (hardCapUsd <= 0 && softCapUsd <= 0) {
    return { skip: false, mode: '', reason: '' };
  }

  const pricing = getBrightdataPricing();
  const now = new Date();
  const { monthStartUtc, nextMonthStartUtc } = kstMonthBoundaries(now);

  let requests: number | null = null;
  let source = 'official';
  const official = await fetchOfficialUsage();
  if (official) {
    requests = official.totalRequests;
  } else {
    requests = await countLocalMonthlySuccess(monthStartUtc);
    source = 'local_fallback';
  }
  if (requests === null) {
    console.warn('[prepare] 사용량 조회 전부 실패 — 예산 가드 없이 진행');
    return { skip: false, mode: '', reason: '' };
  }

  const costSoFar = estimateMonthlyCost(requests, pricing);
  const elapsedRatio = Math.min(
    1,
    Math.max(
      1 / 31,
      (now.getTime() - monthStartUtc.getTime()) /
        (nextMonthStartUtc.getTime() - monthStartUtc.getTime())
    )
  );
  const projected = costSoFar / elapsedRatio;
  console.log(
    `[prepare] 예산 판정(${source}): 이번 달 ${requests.toLocaleString()}건 ≈ $${costSoFar.toFixed(2)}, ` +
      `월말 예상 $${projected.toFixed(2)} (hard $${hardCapUsd} / soft $${softCapUsd})`
  );

  if (hardCapUsd > 0 && costSoFar >= hardCapUsd) {
    return {
      skip: true,
      mode: '',
      reason:
        `월 예산 초과로 자동 수집 skip — 이번 달 지출 $${costSoFar.toFixed(2)} ≥ ` +
        `hard cap $${hardCapUsd} (${source}, ${requests.toLocaleString()}건)`,
    };
  }
  if (softCapUsd > 0 && projected >= softCapUsd) {
    return {
      skip: false,
      mode: 'degrade',
      reason:
        `월말 예상 지출 $${projected.toFixed(2)} ≥ soft cap $${softCapUsd} — ` +
        `등급 주기 2배 완화(degrade) 모드로 수집`,
    };
  }
  return { skip: false, mode: '', reason: '' };
}

main().catch((err) => {
  console.error('[prepare] 실패:', err instanceof Error ? err.message : err);
  process.exit(1);
});
