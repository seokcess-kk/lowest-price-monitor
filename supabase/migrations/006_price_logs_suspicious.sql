-- price_logs.is_suspicious
-- 직전 값 대비 큰 변동(예: 50% 이상 하락/상승)을 감지한 행에 true로 마킹.
-- 대시보드에서 경고 표시용. 데이터는 그대로 저장되지만 신뢰도 플래그로 사용.

ALTER TABLE price_logs
  ADD COLUMN IF NOT EXISTS is_suspicious boolean NOT NULL DEFAULT false;

-- 검색 성능을 위한 부분 인덱스 (suspicious만)
CREATE INDEX IF NOT EXISTS idx_price_logs_suspicious
  ON price_logs(product_id, collected_at DESC)
  WHERE is_suspicious = true;
