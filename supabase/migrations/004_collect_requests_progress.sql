-- collect_requests에 진행률 표시용 컬럼 추가
-- 대시보드 즉시 수집 버튼이 "X/Y 상품 완료" 진행률을 표시하기 위해 사용

ALTER TABLE collect_requests
  ADD COLUMN IF NOT EXISTS progress_done integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_total integer DEFAULT 0;
