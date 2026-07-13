-- Web Unlocker zone 단위 장애(전 채널 200+빈 본문) 시간 창 감지 RPC.
--
-- 배경: zone 과금/한도 문제가 생기면 대상 사이트와 무관하게 모든 호출이
-- status 200 + 빈 본문(response_bytes null)으로 일관되게 돌아온다 (실측 2026-07-11~13).
-- 이 시간대의 scrape_errors는 상품·URL 문제가 아니므로 연속 실패 백오프 카운트에서
-- 제외해야 한다 — 제외하지 않으면 zone 복구 후에도 백오프(1~3일) 동안 수집 공백이 생긴다.
--
-- 판정: 1시간 버킷 내 호출이 p_min_calls건 이상이면서 그중 p_zero_share 이상이
-- 200+빈 본문이면 장애 창. 정상 운영에서는 쿠팡의 상시 빈 응답(호출의 ~35%)이 섞여도
-- 이 비율에 못 미친다 (실측: 정상 시간대 최대 ~61%, 장애 시간대 99%+).
--
-- 버킷 경계는 date_trunc가 아니라 epoch 나눗셈으로 자른다 — 호출측(JS)이
-- Math.floor(ms / 3600000)으로 같은 경계를 재현해야 하므로 세션 타임존과 무관해야 한다.
-- WHERE created_at 범위는 idx_brightdata_usage_created_at 인덱스로 커버된다.
CREATE OR REPLACE FUNCTION zone_outage_windows(
  p_since timestamptz,
  p_min_calls int DEFAULT 20,
  p_zero_share numeric DEFAULT 0.9
)
RETURNS TABLE(bucket_start timestamptz, total_calls bigint, zero_byte_calls bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT
    to_timestamp(floor(extract(epoch FROM created_at) / 3600) * 3600) AS bucket_start,
    count(*) AS total_calls,
    count(*) FILTER (WHERE status_code = 200 AND COALESCE(response_bytes, 0) = 0) AS zero_byte_calls
  FROM brightdata_usage_logs
  WHERE created_at >= p_since
  GROUP BY 1
  HAVING count(*) >= p_min_calls
    AND count(*) FILTER (WHERE status_code = 200 AND COALESCE(response_bytes, 0) = 0)
        >= count(*) * p_zero_share
  ORDER BY 1;
$$;
