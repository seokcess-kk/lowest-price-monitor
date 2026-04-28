/** 수집 채널 */
export type Channel = 'coupang' | 'naver' | 'danawa';

/** brands 테이블 */
export interface Brand {
  id: string;
  name: string;
  created_at: string;
}

/** products 테이블 — brand_name은 brand join 결과(API 응답에만 채워짐) */
export interface Product {
  id: string;
  name: string;
  sabangnet_code: string | null;
  brand_id: string | null;
  brand_name?: string | null;
  coupang_url: string | null;
  naver_url: string | null;
  danawa_url: string | null;
  created_at: string;
  is_active: boolean;
}

/** price_logs 테이블 */
export interface PriceLog {
  id: string;
  product_id: string;
  channel: Channel;
  price: number;
  store_name: string | null;
  collected_at: string;
  is_manual: boolean;
  is_suspicious: boolean;
}

/** 채널별 가격 정보 (메인 페이지 표시용) */
export interface ChannelPrice {
  channel: Channel;
  price: number;
  store_name: string | null;
  change: number | null;
}

/** 채널별 URL 맵 */
export interface ProductUrls {
  coupang: string | null;
  naver: string | null;
  danawa: string | null;
}

/** 메인 페이지 표시용 — 상품별 채널 가격 + 전일 대비 변동 */
export interface PriceWithChange {
  product_id: string;
  product_name: string;
  sabangnet_code: string | null;
  brand_id: string | null;
  brand_name: string | null;
  urls: ProductUrls;
  prices: ChannelPrice[];
  warnings?: FailureWarning[];
}

/** 상품 등록 입력 — brand_name 우선(없으면 brand_id 그대로). 신규 브랜드는 서버에서 upsert */
export interface CreateProductInput {
  name: string;
  sabangnet_code?: string | null;
  brand_name?: string | null;
  brand_id?: string | null;
  coupang_url?: string | null;
  naver_url?: string | null;
  danawa_url?: string | null;
}

/** 상품 수정 입력 */
export interface UpdateProductInput {
  name?: string;
  sabangnet_code?: string | null;
  brand_name?: string | null;
  brand_id?: string | null;
  coupang_url?: string | null;
  naver_url?: string | null;
  danawa_url?: string | null;
  is_active?: boolean;
}

/** 단일 채널 수집 결과 */
export interface CollectResult {
  product_id: string;
  channel: Channel;
  success: boolean;
  price?: number;
  store_name?: string | null;
  error?: string;
}

/** scrape_errors 테이블 — 수집 실패 로그 */
export interface ScrapeError {
  id: string;
  product_id: string;
  channel: Channel;
  error_message: string;
  created_at: string;
}

/** 연속 실패 경고 정보 */
export interface FailureWarning {
  product_id: string;
  channel: Channel;
  consecutive_failures: number;
}

/** Export 필터 */
export interface ExportFilter {
  start_date: string;
  end_date: string;
  product_ids?: string[];
  brand_ids?: string[];
}
