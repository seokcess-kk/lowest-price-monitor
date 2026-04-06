-- 수집 요청 테이블: 대시보드 → DB → 로컬 PC 폴링
CREATE TABLE collect_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result_success integer,
  result_failed integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX idx_collect_requests_status ON collect_requests (status, created_at DESC);
