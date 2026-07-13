-- 상품×채널×일(KST) 가격 요약 테이블.
--
-- price_logs 원본은 보존 기간(6개월) 이후 삭제되지만, 이 요약은 무기한 보존되어
-- 장기 차트·엑셀 export의 원천이 된다. 대시보드 "현재가/전일 대비"도 이 테이블을 읽는다.
--
-- min_*    : 그날 정상(is_suspicious=false) 로그 중 최저가 — 차트/스파크라인/export용.
--            가격과 판매처는 반드시 같은 로그 행에서 함께 뽑는다 (엇갈림 금지).
--            그날 정상 로그가 없으면 NULL.
-- latest_* : 그날 "최신" 로그 (정상 우선, 정상이 없으면 의심 로그) — 대시보드 현재가 의미 보존.
CREATE TABLE IF NOT EXISTS price_daily (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('coupang', 'naver', 'danawa')),
  date date NOT NULL,
  min_price integer,
  min_store_name text,
  latest_price integer NOT NULL,
  latest_store_name text,
  latest_is_suspicious boolean NOT NULL DEFAULT false,
  sample_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, channel, date)
);

-- 대시보드가 "오늘/어제" 2일 슬라이스를 product .in() 없이 날짜만으로 전량 조회
CREATE INDEX IF NOT EXISTS idx_price_daily_date ON price_daily (date);

-- 기간 [p_from, p_to] (KST 일자)의 요약을 price_logs에서 재계산해 upsert.
-- idempotent: 같은 구간을 몇 번 호출해도 결과 동일. is_suspicious 재마킹(mark_outliers)
-- 이후 다시 호출하면 플립이 요약에 반영된다.
-- 해당 구간에 로그가 전부 사라진 (product, channel, date)의 요약 row는 삭제한다.
CREATE OR REPLACE FUNCTION refresh_price_daily(
  p_from date,
  p_to date,
  p_product_ids uuid[] DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  -- KST 자정 경계를 timestamptz로 변환해 collected_at 인덱스를 태운다
  v_start timestamptz := (p_from::timestamp) AT TIME ZONE 'Asia/Seoul';
  v_end timestamptz := ((p_to + 1)::timestamp) AT TIME ZONE 'Asia/Seoul';
  affected int;
BEGIN
  WITH scoped AS (
    SELECT product_id, channel, price, store_name, collected_at, is_suspicious,
           (collected_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date
    FROM price_logs
    WHERE collected_at >= v_start
      AND collected_at < v_end
      AND (p_product_ids IS NULL OR product_id = ANY(p_product_ids))
  ),
  agg AS (
    SELECT product_id, channel, kst_date, count(*)::int AS sample_count
    FROM scoped
    GROUP BY product_id, channel, kst_date
  ),
  -- 그날 정상 로그의 최저가 행 (가격·판매처 페어링 유지)
  min_rows AS (
    SELECT DISTINCT ON (product_id, channel, kst_date)
           product_id, channel, kst_date,
           price AS min_price, store_name AS min_store_name
    FROM scoped
    WHERE NOT is_suspicious
    ORDER BY product_id, channel, kst_date, price ASC, collected_at DESC
  ),
  -- 그날 최신 행 (정상 우선 — is_suspicious ASC가 정상(false)을 앞세운다)
  latest_rows AS (
    SELECT DISTINCT ON (product_id, channel, kst_date)
           product_id, channel, kst_date,
           price AS latest_price, store_name AS latest_store_name,
           is_suspicious AS latest_is_suspicious
    FROM scoped
    ORDER BY product_id, channel, kst_date, is_suspicious ASC, collected_at DESC
  ),
  upserted AS (
    INSERT INTO price_daily (
      product_id, channel, date, min_price, min_store_name,
      latest_price, latest_store_name, latest_is_suspicious, sample_count, updated_at
    )
    SELECT a.product_id, a.channel, a.kst_date,
           m.min_price, m.min_store_name,
           l.latest_price, l.latest_store_name, l.latest_is_suspicious,
           a.sample_count, now()
    FROM agg a
    JOIN latest_rows l USING (product_id, channel, kst_date)
    LEFT JOIN min_rows m USING (product_id, channel, kst_date)
    ON CONFLICT (product_id, channel, date) DO UPDATE SET
      min_price = EXCLUDED.min_price,
      min_store_name = EXCLUDED.min_store_name,
      latest_price = EXCLUDED.latest_price,
      latest_store_name = EXCLUDED.latest_store_name,
      latest_is_suspicious = EXCLUDED.latest_is_suspicious,
      sample_count = EXCLUDED.sample_count,
      updated_at = now()
    RETURNING 1
  ),
  removed AS (
    DELETE FROM price_daily pd
    WHERE pd.date BETWEEN p_from AND p_to
      AND (p_product_ids IS NULL OR pd.product_id = ANY(p_product_ids))
      AND NOT EXISTS (
        SELECT 1 FROM scoped s
        WHERE s.product_id = pd.product_id
          AND s.channel = pd.channel
          AND s.kst_date = pd.date
      )
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM upserted) + (SELECT count(*) FROM removed)
  INTO affected;
  RETURN affected;
END;
$$;

-- 백필: 기존 price_logs 전 구간의 요약 생성.
-- 현재 데이터량(수십만 행 이하)에서는 단일 호출로 충분하다.
-- 데이터가 수백만 행 이상인 환경에 적용할 때는 이 구문을 지우고 월 단위로 나눠 호출할 것.
SELECT refresh_price_daily(
  COALESCE(
    (SELECT min((collected_at AT TIME ZONE 'Asia/Seoul')::date) FROM price_logs),
    (now() AT TIME ZONE 'Asia/Seoul')::date
  ),
  (now() AT TIME ZONE 'Asia/Seoul')::date
);
