-- 수집 샤딩 + 진행률 원자화.
--
-- 배경: 5,000개 상품 규모에서는 수집을 GitHub Actions matrix 샤드(병렬 job)로 나눠야
-- 6시간 한도를 지킬 수 있다. 여러 샤드가 같은 collect_requests row를 갱신하므로
-- 기존의 "절대값 덮어쓰기 UPDATE"는 경합으로 진행률이 서로를 지운다 → 원자적 RPC로 전환.
--
-- last_progress_at 은 heartbeat: stale 판정(collect-cleanup)이 이 값을 기준으로
-- "정말 죽은" 실행만 failed 처리한다 (기존 created_at 5분 룰은 장시간 수집을 오살).

ALTER TABLE collect_requests
  ADD COLUMN IF NOT EXISTS shards_total integer,
  ADD COLUMN IF NOT EXISTS shards_done integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shard_stats jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS trigger_source text,
  ADD COLUMN IF NOT EXISTS last_progress_at timestamptz;

-- 샤드 시작 신고.
-- 단일 UPDATE의 SET 식은 모두 갱신 전(old) row 기준으로 평가되고 row lock으로 직렬화되므로:
--   - 첫 샤드(status='pending')가 running 전환 + progress 카운터 리셋
--   - 각 샤드는 자기 몫(필터 후 실제 처리할 상품 수)을 progress_total에 가산
--     (배치 생성 시 미리 넣어둔 progress_total은 비활성/제외 상품을 포함할 수 있어 리셋이 정확)
CREATE OR REPLACE FUNCTION start_collect_shard(
  p_request_id uuid,
  p_shards_total int,
  p_progress_total_inc int
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE collect_requests SET
    progress_total = CASE WHEN status = 'pending' THEN 0 ELSE COALESCE(progress_total, 0) END
                     + p_progress_total_inc,
    progress_done = CASE WHEN status = 'pending' THEN 0 ELSE COALESCE(progress_done, 0) END,
    status = CASE WHEN status = 'pending' THEN 'running' ELSE status END,
    started_at = COALESCE(started_at, now()),
    shards_total = COALESCE(shards_total, p_shards_total),
    last_progress_at = now()
  WHERE id = p_request_id;
$$;

-- 진행률 원자적 증가 (절대값 덮어쓰기 금지 — 샤드 간 경합 방지) + heartbeat 갱신
CREATE OR REPLACE FUNCTION increment_collect_progress(
  p_request_id uuid,
  p_inc int DEFAULT 1
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE collect_requests SET
    progress_done = COALESCE(progress_done, 0) + p_inc,
    last_progress_at = now()
  WHERE id = p_request_id;
$$;

-- 샤드 종료 신고: 집계 가산 + 마지막 샤드가 completed 확정.
-- 반환값 true = 이 호출이 마지막 샤드였음 → 호출측이 mark_outliers 등 "한 번만" 도는
-- 후처리를 실행할지 판단하는 데 쓴다.
CREATE OR REPLACE FUNCTION finalize_collect_shard(
  p_request_id uuid,
  p_success int,
  p_failed int,
  p_error text,
  p_shard_stat jsonb
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_all_done boolean;
BEGIN
  UPDATE collect_requests SET
    shards_done = shards_done + 1,
    result_success = COALESCE(result_success, 0) + p_success,
    result_failed = COALESCE(result_failed, 0) + p_failed,
    error_message = CASE
      WHEN p_error IS NULL OR p_error = '' THEN error_message
      ELSE left(concat_ws(E'\n', error_message, p_error), 8000)
    END,
    shard_stats = CASE
      WHEN p_shard_stat IS NULL THEN shard_stats
      ELSE shard_stats || p_shard_stat
    END,
    last_progress_at = now(),
    status = CASE
      WHEN shards_done + 1 >= COALESCE(shards_total, 1) THEN 'completed'
      ELSE status
    END,
    completed_at = CASE
      WHEN shards_done + 1 >= COALESCE(shards_total, 1) THEN now()
      ELSE completed_at
    END
  WHERE id = p_request_id
  RETURNING shards_done >= COALESCE(shards_total, 1) INTO v_all_done;
  RETURN COALESCE(v_all_done, false);
END;
$$;
