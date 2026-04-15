-- 상품별 즉시 수집 지원: collect_requests 에 product_id 컬럼 추가
-- NULL 이면 전역 수집, 값이 있으면 해당 상품 단일 수집
ALTER TABLE collect_requests
  ADD COLUMN product_id uuid REFERENCES products(id) ON DELETE CASCADE;

-- 전역 수집 진행 상태 조회 (product_id IS NULL 필터) 가속
CREATE INDEX idx_collect_requests_global_status
  ON collect_requests (status, created_at DESC)
  WHERE product_id IS NULL;

-- 상품별 진행 상태 조회 가속
CREATE INDEX idx_collect_requests_product_status
  ON collect_requests (product_id, status, created_at DESC)
  WHERE product_id IS NOT NULL;
