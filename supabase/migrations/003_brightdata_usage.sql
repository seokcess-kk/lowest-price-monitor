-- Bright Data Web Unlocker 호출 로그 (B: 로컬 추적)
CREATE TABLE brightdata_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  status_code integer,
  success boolean NOT NULL,
  response_bytes integer,
  duration_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brightdata_usage_created_at ON brightdata_usage_logs (created_at DESC);
CREATE INDEX idx_brightdata_usage_channel ON brightdata_usage_logs (channel, created_at DESC);

-- Bright Data 공식 API에서 가져온 사용량 스냅샷 (A: 청구 검증)
CREATE TABLE brightdata_stats_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  request_count bigint,
  bandwidth_bytes bigint,
  raw_response jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brightdata_snapshots_period ON brightdata_stats_snapshots (period_end DESC);
