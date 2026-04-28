-- 초기 브랜드 시드. name UNIQUE 제약 덕에 재실행 안전.
INSERT INTO brands (name) VALUES
  ('PB'),
  ('제일제당')
ON CONFLICT (name) DO NOTHING;
