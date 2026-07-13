-- 보존 정책 (retention).
--
-- 기본값:
--   price_logs            : 6개월  (api/export·api/prices의 RAW_RETENTION_MONTHS와 일치 유지)
--   scrape_errors         : 90일
--   collect_requests      : 30일   (completed/failed만 — 진행 중 row는 건드리지 않음)
--   brightdata_usage_logs : 12개월 (청구 검증용)
--
-- 호출 계약:
--   - PostgREST 경유 호출은 statement timeout에 걸릴 수 있어, 한 번의 호출은
--     테이블당 최대 p_batch행 수준만 지우고 done=false를 반환한다.
--     호출측(scripts/maintenance.ts)이 done=true까지 반복 호출한다.
--   - price_logs는 삭제 전에 해당 날짜 구간의 refresh_price_daily를 먼저 실행해
--     "요약 없는 원본 삭제"를 구조적으로 차단한다.
--   - price_logs 배치는 반드시 KST 일 경계로 자른다: 하루의 일부 행만 지우면
--     다음 호출의 refresh가 "남은 행만"으로 그 날짜 요약을 덮어써 손상되기 때문.
--   ⚠ 삭제가 끝난 과거 구간에 refresh_price_daily를 다시 호출하지 말 것 —
--     원본이 없으므로 요약 row가 삭제된다. (유지보수 대사는 최근 35일만 대상)
CREATE OR REPLACE FUNCTION purge_old_data(
  p_price_log_months int DEFAULT 6,
  p_scrape_error_days int DEFAULT 90,
  p_collect_request_days int DEFAULT 30,
  p_brightdata_months int DEFAULT 12,
  p_batch int DEFAULT 20000
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_today_kst date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_price_cutoff_key date := (v_today_kst::timestamp - make_interval(months => p_price_log_months))::date;
  v_price_cutoff timestamptz := (v_price_cutoff_key::timestamp) AT TIME ZONE 'Asia/Seoul';
  v_scrape_cutoff timestamptz := now() - make_interval(days => p_scrape_error_days);
  v_request_cutoff timestamptz := now() - make_interval(days => p_collect_request_days);
  v_usage_cutoff timestamptz := now() - make_interval(months => p_brightdata_months);
  v_batch_min date;
  v_batch_max date;
  v_price_logs bigint := 0;
  v_scrape bigint := 0;
  v_requests bigint := 0;
  v_usage bigint := 0;
  v_done boolean;
BEGIN
  -- 1) price_logs — 요약 선행 생성 후 일 경계 배치 삭제
  SELECT min(kst), max(kst) INTO v_batch_min, v_batch_max
  FROM (
    SELECT (collected_at AT TIME ZONE 'Asia/Seoul')::date AS kst
    FROM price_logs
    WHERE collected_at < v_price_cutoff
    ORDER BY collected_at ASC
    LIMIT p_batch
  ) t;

  IF v_batch_min IS NOT NULL THEN
    PERFORM refresh_price_daily(v_batch_min, v_batch_max);
    DELETE FROM price_logs
    WHERE collected_at < LEAST(
      v_price_cutoff,
      ((v_batch_max + 1)::timestamp) AT TIME ZONE 'Asia/Seoul'
    );
    GET DIAGNOSTICS v_price_logs = ROW_COUNT;
  END IF;

  -- 2) scrape_errors
  DELETE FROM scrape_errors
  WHERE id IN (
    SELECT id FROM scrape_errors
    WHERE created_at < v_scrape_cutoff
    LIMIT p_batch
  );
  GET DIAGNOSTICS v_scrape = ROW_COUNT;

  -- 3) collect_requests — 종료된 요청만
  DELETE FROM collect_requests
  WHERE id IN (
    SELECT id FROM collect_requests
    WHERE created_at < v_request_cutoff
      AND status IN ('completed', 'failed')
    LIMIT p_batch
  );
  GET DIAGNOSTICS v_requests = ROW_COUNT;

  -- 4) brightdata_usage_logs
  DELETE FROM brightdata_usage_logs
  WHERE id IN (
    SELECT id FROM brightdata_usage_logs
    WHERE created_at < v_usage_cutoff
    LIMIT p_batch
  );
  GET DIAGNOSTICS v_usage = ROW_COUNT;

  v_done := NOT EXISTS (SELECT 1 FROM price_logs WHERE collected_at < v_price_cutoff)
    AND NOT EXISTS (SELECT 1 FROM scrape_errors WHERE created_at < v_scrape_cutoff)
    AND NOT EXISTS (
      SELECT 1 FROM collect_requests
      WHERE created_at < v_request_cutoff AND status IN ('completed', 'failed')
    )
    AND NOT EXISTS (SELECT 1 FROM brightdata_usage_logs WHERE created_at < v_usage_cutoff);

  RETURN jsonb_build_object(
    'price_logs', v_price_logs,
    'scrape_errors', v_scrape,
    'collect_requests', v_requests,
    'brightdata_usage_logs', v_usage,
    'price_log_cutoff', v_price_cutoff_key,
    'done', v_done
  );
END;
$$;

-- 대안: GitHub Actions(maintenance.yml) 대신 pg_cron으로 돌리려면
-- Supabase 대시보드에서 pg_cron extension 활성화 후 아래 주석을 해제.
-- (기본 채택은 GH Actions — 실행 로그·실패 가시성·인프라 일원화 때문)
-- SELECT cron.schedule('purge-old-data', '0 20 * * *', $$SELECT purge_old_data()$$);
