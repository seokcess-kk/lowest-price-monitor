-- 5,000개 상품 규모 대비 부재 인덱스 보강.
-- 각 인덱스의 근거:
--   idx_products_active_created  — 활성 상품 목록/수집 대상 조회가 is_active 필터 + created_at 정렬
--   idx_products_brand           — 브랜드 필터(.in('brand_id', ...))가 관리/대시보드/export에서 상시 사용
--   idx_price_logs_collected_at  — "마지막 수집 시각" top-1 조회 + 보존 정책의 기간 삭제 범위 스캔
--   idx_scrape_errors_created_at — /errors 최신순 정렬·since 필터 + 90일 보존 삭제
--   idx_collect_requests_created_at — 30일 보존 삭제 범위 스캔
CREATE INDEX IF NOT EXISTS idx_products_active_created
  ON products (created_at DESC) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_products_brand
  ON products (brand_id) WHERE brand_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_price_logs_collected_at
  ON price_logs (collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_errors_created_at
  ON scrape_errors (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_collect_requests_created_at
  ON collect_requests (created_at);
