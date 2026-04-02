-- products 테이블
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  coupang_url text,
  naver_url text,
  danawa_url text,
  created_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true
);

-- price_logs 테이블
CREATE TABLE IF NOT EXISTS price_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('coupang', 'naver', 'danawa')),
  price integer NOT NULL,
  store_name text,
  collected_at timestamptz DEFAULT now(),
  is_manual boolean DEFAULT false
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_price_logs_product_date ON price_logs(product_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_logs_product_channel_date ON price_logs(product_id, channel, collected_at DESC);

-- scrape_errors 테이블 (수집 실패 로그)
CREATE TABLE IF NOT EXISTS scrape_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('coupang', 'naver', 'danawa')),
  error_message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scrape_errors_product_channel ON scrape_errors(product_id, channel);
