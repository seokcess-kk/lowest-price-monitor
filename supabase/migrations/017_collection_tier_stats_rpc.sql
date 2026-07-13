-- (상품×채널)별 수집 등급 판정 통계.
--
-- 3단계 저빈도 등급제(HOT 매일 / WARM 2일 / COLD 주 1회)의 판정 근거를
-- 원시 이력을 앱으로 나르지 않고 DB에서 집계해 돌려준다.
--
--   last_collected_at : suspicious 포함 마지막 수집 시각 (= 마지막 과금 시도)
--   last_change_at    : 정상(is_suspicious=false) 가격이 직전 정상가와 달라진 마지막 시각
--   first_normal_at   : 조회 창 내 첫 정상 수집 시각 (변동이 한 번도 없을 때 안정 기간 anchor)
--   normal_samples    : 창 내 정상 수집 횟수 (2 미만이면 무변동 단정 불가 → 호출측이 HOT 처리)
--
-- p_lookback_days 기본 37 = COLD 판정 창(30일) + COLD 주기(7일) 마진.
-- 기존 idx_price_logs_product_channel_date 인덱스로 커버된다.
-- 결과는 ORDER BY 고정 — 호출측이 range 페이지네이션으로 1,000행 상한을 넘겨 받는다.
CREATE OR REPLACE FUNCTION collection_tier_stats(
  p_product_ids uuid[],
  p_lookback_days int DEFAULT 37
)
RETURNS TABLE(
  product_id uuid,
  channel text,
  last_collected_at timestamptz,
  last_change_at timestamptz,
  first_normal_at timestamptz,
  normal_samples int
)
LANGUAGE sql
STABLE
AS $$
  WITH win AS (
    SELECT pl.product_id, pl.channel, pl.collected_at, pl.price, pl.is_suspicious
    FROM price_logs pl
    WHERE pl.product_id = ANY(p_product_ids)
      AND pl.collected_at >= now() - make_interval(days => p_lookback_days)
  ),
  normal AS (
    SELECT w.product_id, w.channel, w.collected_at,
           (w.price IS DISTINCT FROM lag(w.price) OVER pc)
             AND (lag(w.price) OVER pc IS NOT NULL) AS changed
    FROM win w
    WHERE NOT w.is_suspicious
    WINDOW pc AS (PARTITION BY w.product_id, w.channel ORDER BY w.collected_at)
  ),
  normal_agg AS (
    SELECT n.product_id, n.channel,
           max(n.collected_at) FILTER (WHERE n.changed) AS last_change_at,
           min(n.collected_at) AS first_normal_at,
           count(*)::int AS normal_samples
    FROM normal n
    GROUP BY n.product_id, n.channel
  ),
  all_agg AS (
    SELECT w.product_id, w.channel, max(w.collected_at) AS last_collected_at
    FROM win w
    GROUP BY w.product_id, w.channel
  )
  SELECT a.product_id, a.channel, a.last_collected_at,
         na.last_change_at, na.first_normal_at, COALESCE(na.normal_samples, 0)
  FROM all_agg a
  LEFT JOIN normal_agg na USING (product_id, channel)
  ORDER BY a.product_id, a.channel;
$$;
