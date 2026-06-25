-- 필터된 다수 상품 일괄 수집 지원: collect_requests 에 product_ids 컬럼 추가.
-- product_id(단일) / NULL(전역)과 구분되는 "배치" 레인.
--   - product_id IS NULL  AND product_ids IS NULL  → 전역 수집
--   - product_id IS NOT NULL                       → 단일 상품 수집
--   - product_id IS NULL  AND product_ids 존재     → 필터 배치 수집
-- 배치도 product_id IS NULL 이라 기존 전역 진행률 폴링/동시성 차단 로직을 그대로 재사용한다.
ALTER TABLE collect_requests
  ADD COLUMN IF NOT EXISTS product_ids uuid[];
