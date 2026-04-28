-- 가격 이력 이상치 자동 마킹.
-- 같은 (product_id, channel) 그룹의 N일 윈도우 안에서
--   median(가격) ± k * MAD 를 벗어나는 row를 is_suspicious=true 로 표시.
-- MAD가 0(가격이 거의 일정)이면 ratio 기반 fallback (예: median 대비 50% 이상 벗어남).
-- 표본이 적은 그룹(< p_min_samples)은 통계적 의미가 없어 skip — 보수적 마킹.
CREATE OR REPLACE FUNCTION mark_outliers(
  p_window_days int DEFAULT 30,
  p_min_samples int DEFAULT 5,
  p_mad_threshold numeric DEFAULT 6.0,
  p_ratio_threshold numeric DEFAULT 0.5
)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  affected int;
BEGIN
  WITH meds AS (
    SELECT product_id, channel,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS med_price,
           count(*) AS n
    FROM price_logs
    WHERE collected_at >= now() - (p_window_days || ' days')::interval
      AND is_suspicious = false
      AND price > 0
    GROUP BY product_id, channel
    HAVING count(*) >= p_min_samples
  ),
  mad_calc AS (
    SELECT pl.product_id, pl.channel,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(pl.price - m.med_price)) AS mad
    FROM price_logs pl
    JOIN meds m USING (product_id, channel)
    WHERE pl.collected_at >= now() - (p_window_days || ' days')::interval
      AND pl.is_suspicious = false
      AND pl.price > 0
    GROUP BY pl.product_id, pl.channel
  ),
  flagged AS (
    UPDATE price_logs pl
    SET is_suspicious = true
    FROM meds m
    LEFT JOIN mad_calc mc
      ON mc.product_id = m.product_id AND mc.channel = m.channel
    WHERE pl.product_id = m.product_id
      AND pl.channel = m.channel
      AND pl.collected_at >= now() - (p_window_days || ' days')::interval
      AND pl.is_suspicious = false
      AND pl.price > 0
      AND (
        -- MAD=0인 경우 (가격이 거의 일정): median 대비 비율로 검사
        (COALESCE(mc.mad, 0) = 0
          AND abs(pl.price - m.med_price) > m.med_price * p_ratio_threshold)
        OR
        -- MAD>0: modified Z-score 등가 임계
        (COALESCE(mc.mad, 0) > 0
          AND abs(pl.price - m.med_price) / mc.mad > p_mad_threshold)
      )
    RETURNING pl.id
  )
  SELECT count(*)::int INTO affected FROM flagged;
  RETURN affected;
END;
$$;
