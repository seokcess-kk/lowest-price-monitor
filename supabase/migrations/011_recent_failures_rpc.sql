-- (product_id, channel) 그룹별 최근 N건 실패만 반환하는 RPC.
-- 단일 limit 쿼리는 상품 수가 늘면 일부 그룹의 데이터가 잘려 연속 실패 카운트가
-- 부정확해질 수 있어 window function으로 그룹별 잘라낸다.
CREATE OR REPLACE FUNCTION recent_failures_per_channel(
  p_since timestamptz,
  p_product_ids uuid[],
  p_per_group int DEFAULT 10
)
RETURNS TABLE(product_id uuid, channel text, created_at timestamptz)
LANGUAGE sql
STABLE
AS $$
  SELECT product_id, channel, created_at FROM (
    SELECT
      product_id,
      channel,
      created_at,
      row_number() OVER (
        PARTITION BY product_id, channel
        ORDER BY created_at DESC
      ) AS rn
    FROM scrape_errors
    WHERE created_at >= p_since
      AND product_id = ANY(p_product_ids)
  ) t
  WHERE rn <= p_per_group
  ORDER BY product_id, channel, created_at DESC;
$$;
