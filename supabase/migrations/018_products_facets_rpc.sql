-- 관리 화면 상태/운영/브랜드별 상품 카운트.
--
-- 서버 페이지네이션 전환으로 클라이언트가 전체 상품을 들고 있지 않으므로,
-- "다른 필터와 무관한 절대값 카운트"(필터 칩의 숫자)를 단일 스캔으로 서버에서 계산한다.
-- 5,000행 수준에서는 수 ms.
--
-- URL 존부는 NULL과 빈 문자열을 모두 "미등록"으로 취급 (프론트의 truthiness 판정과 동일).
CREATE OR REPLACE FUNCTION products_facets()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT
      is_active,
      brand_id,
      (CASE WHEN NULLIF(coupang_url, '') IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN NULLIF(naver_url, '') IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN NULLIF(danawa_url, '') IS NOT NULL THEN 1 ELSE 0 END) AS url_count
    FROM products
  ),
  brand_counts AS (
    SELECT COALESCE(jsonb_object_agg(brand_id::text, cnt), '{}'::jsonb) AS by_brand
    FROM (
      SELECT brand_id, count(*) AS cnt
      FROM base
      WHERE brand_id IS NOT NULL
      GROUP BY brand_id
    ) t
  )
  SELECT jsonb_build_object(
    'status', jsonb_build_object(
      'all', (SELECT count(*) FROM base),
      'active', (SELECT count(*) FROM base WHERE is_active),
      'inactive', (SELECT count(*) FROM base WHERE NOT is_active)
    ),
    'ops', jsonb_build_object(
      'noUrl', (SELECT count(*) FROM base WHERE url_count = 0),
      'partialUrl', (SELECT count(*) FROM base WHERE url_count BETWEEN 1 AND 2),
      'noBrand', (SELECT count(*) FROM base WHERE brand_id IS NULL)
    ),
    'brands', (SELECT by_brand FROM brand_counts),
    'uncategorized', (SELECT count(*) FROM base WHERE brand_id IS NULL)
  );
$$;
