-- brands 테이블 + products.brand_id FK
-- 브랜드 표기 표준화를 위해 별도 테이블로 분리. name은 UNIQUE.
-- 브랜드 삭제 시 상품은 유지하고 brand_id만 NULL로 (ON DELETE SET NULL).
CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES brands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_brand_id
  ON products(brand_id)
  WHERE brand_id IS NOT NULL;
