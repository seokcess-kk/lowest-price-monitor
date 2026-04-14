-- products.sabangnet_code
-- 사방넷 ERP 상품코드. 선택 필드(없이 등록 가능). 중복은 애플리케이션 레이어에서
-- check-duplicates로 감지 후 사용자 승인을 받는다 — DB UNIQUE는 걸지 않는다.
ALTER TABLE products ADD COLUMN IF NOT EXISTS sabangnet_code text;

CREATE INDEX IF NOT EXISTS idx_products_sabangnet_code
  ON products(sabangnet_code)
  WHERE sabangnet_code IS NOT NULL;
