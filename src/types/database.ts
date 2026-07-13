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

/**
 * price_daily 테이블 — 상품×채널×일(KST) 요약.
 * 원본(price_logs)은 보존 기간 후 삭제되지만 이 요약은 무기한 보존 — 장기 차트·export의 원천.
 * min_*: 그날 정상 로그의 최저가(+판매처 페어링), 정상 로그가 없으면 null.
 * latest_*: 그날 최신 로그 (정상 우선) — 대시보드 "현재가" 의미.
 */
export interface PriceDaily {
  product_id: string;
  channel: Channel;
  /** 'YYYY-MM-DD' (KST) */
  date: string;
  min_price: number | null;
  min_store_name: string | null;
  latest_price: number;
  latest_store_name: string | null;
  latest_is_suspicious: boolean;
  sample_count: number;
  updated_at: string;
}

/**
 * GET /api/prices 응답 행 — PriceLog superset.
 * 원본 보존 기간(6개월) 이전 구간은 price_daily에서 합성된 행(source='daily')로 채워진다:
 * 하루 1행(그날 정상 최저가), id는 'daily-' 접두사의 합성 키.
 */
export type PricePoint = PriceLog & { source?: 'raw' | 'daily' };

/** 채널별 가격 정보 (메인 페이지 표시용) */
export interface ChannelPrice {
  channel: Channel;
  price: number;
  store_name: string | null;
  change: number | null;
  /** 가격 이상치로 마킹된 로그를 사용한 경우. UI에서 시각적으로 구분. */
  is_suspicious?: boolean;
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

/** 상품 상태 필터 */
export type ProductStatusFilter = 'all' | 'active' | 'inactive';
/** 운영 프리셋 필터 — 정리 작업이 필요한 상품 찾기 */
export type ProductOpsFilter = 'none' | 'noUrl' | 'partialUrl' | 'noBrand';
export type ProductSortKey = 'created' | 'name' | 'status';
export type SortDirection = 'asc' | 'desc';

/** products_facets() RPC 결과 — 관리 화면의 절대값 카운트 (필터와 무관한 전체 기준) */
export interface ProductFacets {
  status: { all: number; active: number; inactive: number };
  ops: { noUrl: number; partialUrl: number; noBrand: number };
  /** brand_id → 상품 수 */
  brands: Record<string, number>;
  uncategorized: number;
}

/** GET /api/products 응답 (서버 페이지네이션) */
export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  page_size: number;
  /** include_facets=true 요청 시에만 동봉 */
  facets?: ProductFacets;
}

/** GET /api/products/ids 응답 — 필터 결과 전체 선택용 (row 없이 id만) */
export interface ProductIdsResponse {
  ids: string[];
  total: number;
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
  /** 가장 최근 실패 사유 (scrape_errors.error_message). 없으면 빈 문자열 */
  last_failure_message: string;
  /** 가장 최근 실패 시각 (ISO). 없으면 빈 문자열 */
  last_failure_at: string;
}

/** 전체 KPI 집계 (대시보드 SummaryCards) */
export interface SummaryStats {
  totalProducts: number;
  changedProducts: number;
  averageChangePct: number | null;
  failedChannels: number;
}

/** 메인 목록 변동 필터 */
export type ChangeFilterKey =
  | 'all'
  | 'changed'
  | 'bigDrop'
  | 'failed'
  | 'drops'
  | 'rises'
  | 'missing';

export interface PanelEntry {
  item: PriceWithChange;
  pct: number;
}

/** ActionPanels 4-패널 서버 집계 — Top N + 전체 카운트 */
export interface PanelGroups {
  drops: PanelEntry[];
  rises: PanelEntry[];
  failed: PriceWithChange[];
  missing: PriceWithChange[];
  counts: { drops: number; rises: number; failed: number; missing: number };
}

/**
 * GET /api/dashboard 응답 (v2 — 서버 필터/페이지네이션).
 * items는 요청한 페이지 슬라이스, 나머지 집계(summary/filter_counts/panel/brand_counts)는
 * 검색·브랜드 필터가 적용된 "전체" 기준. sparklines는 페이지 내 상품만.
 */
export interface DashboardResponse {
  items: PriceWithChange[];
  sparklines: Record<string, number[]>;
  total: number;
  page: number;
  page_size: number;
  summary: SummaryStats;
  filter_counts: { all: number; changed: number; bigDrop: number; failed: number };
  panel: PanelGroups;
  brand_counts: { byId: Record<string, number>; uncategorized: number };
  lastCollectedAt: string | null;
}

/** POST /api/export 요청 body — 대량 product_ids도 URL 한도 없이 전달 */
export interface ExportRequest {
  start_date: string;
  end_date: string;
  product_ids?: string[];
  brand_ids?: string[];
  /** raw: price_logs 원본 (보존 기간 내만) / daily: price_daily 요약 (기간 무제한) */
  mode: 'raw' | 'daily';
  include_suspicious?: boolean;
  count_only?: boolean;
}

/** Export 응답 1행 (xlsx 시트 행) */
export interface ExportRow {
  date: string;
  productName: string;
  sabangnetCode: string | null;
  brandName: string | null;
  channel: string;
  price: number;
  storeName: string | null;
}
