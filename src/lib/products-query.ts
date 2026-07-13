import type {
  ProductOpsFilter,
  ProductSortKey,
  ProductStatusFilter,
  SortDirection,
} from '@/types/database';
import type { createServiceClient } from '@/lib/supabase';

/**
 * GET /api/products 와 GET /api/products/ids 가 공유하는 필터/정렬 빌더.
 * 두 라우트의 필터 의미가 어긋나면 "필터 결과 전체 선택"이 화면과 다른 상품을 고르게 되므로
 * 반드시 이 모듈을 함께 사용한다.
 */

/** BrandFilter의 "미분류" 가상 옵션 id — brand_id IS NULL 매칭 */
export const UNCATEGORIZED_BRAND_ID = '__none__';

export interface ProductListFilters {
  q: string;
  status: ProductStatusFilter;
  brandIds: string[];
  ops: ProductOpsFilter;
  sort: ProductSortKey;
  dir: SortDirection;
}

export function parseProductListFilters(searchParams: URLSearchParams): ProductListFilters {
  const status = searchParams.get('status');
  const ops = searchParams.get('ops');
  const sort = searchParams.get('sort');
  const dir = searchParams.get('dir');
  return {
    q: (searchParams.get('q') ?? '').trim(),
    status: status === 'active' || status === 'inactive' ? status : 'all',
    brandIds: (searchParams.get('brand_ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    ops: ops === 'noUrl' || ops === 'partialUrl' || ops === 'noBrand' ? ops : 'none',
    sort: sort === 'name' || sort === 'status' ? sort : 'created',
    dir: dir === 'asc' ? 'asc' : 'desc',
  };
}

/**
 * PostgREST .or() 구문 안에 넣을 ilike 패턴 이스케이프.
 * `,`/`(`/`)`는 or 구문 파서를 깨뜨리므로 공백으로 치환하고,
 * LIKE 와일드카드(%/_)와 역슬래시는 리터럴 매칭되도록 이스케이프한다.
 */
function escapeIlikeTerm(q: string): string {
  return q
    .replace(/[\\%_]/g, (m) => `\\${m}`)
    .replace(/[,()]/g, ' ')
    .trim();
}

/**
 * 검색어가 브랜드명에 걸리는 brand_id 목록.
 * 클라이언트 검색이 name/사방넷코드/브랜드명 3필드였던 동작을 서버에서 보존하기 위해
 * brands를 사전 조회해 or 조건에 합류시킨다 (브랜드 수는 소규모).
 */
export async function resolveSearchBrandIds(
  supabase: ReturnType<typeof createServiceClient>,
  q: string
): Promise<string[]> {
  const term = escapeIlikeTerm(q);
  if (!term) return [];
  const { data, error } = await supabase
    .from('brands')
    .select('id')
    .ilike('name', `%${term}%`);
  if (error) {
    console.warn(`[products-query] 브랜드명 검색 실패 (무시): ${error.message}`);
    return [];
  }
  return (data ?? []).map((b) => b.id as string);
}

/**
 * 필터를 쿼리 빌더에 적용. searchBrandIds는 resolveSearchBrandIds() 결과.
 * 빌더 제네릭이 복잡해 any를 쓰되 이 모듈 내부로 한정한다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyProductFilters<T extends { or: any; eq: any; is: any; in: any }>(
  query: T,
  filters: ProductListFilters,
  searchBrandIds: string[]
): T {
  let q = query;

  if (filters.q) {
    const term = escapeIlikeTerm(filters.q);
    if (term) {
      const orParts = [
        `name.ilike.*${term}*`,
        `sabangnet_code.ilike.*${term}*`,
      ];
      if (searchBrandIds.length > 0) {
        orParts.push(`brand_id.in.(${searchBrandIds.join(',')})`);
      }
      q = q.or(orParts.join(','));
    }
  }

  if (filters.status === 'active') q = q.eq('is_active', true);
  else if (filters.status === 'inactive') q = q.eq('is_active', false);

  if (filters.brandIds.length > 0) {
    const realIds = filters.brandIds.filter((id) => id !== UNCATEGORIZED_BRAND_ID);
    const hasUncategorized = filters.brandIds.includes(UNCATEGORIZED_BRAND_ID);
    if (realIds.length > 0 && hasUncategorized) {
      q = q.or(`brand_id.in.(${realIds.join(',')}),brand_id.is.null`);
    } else if (realIds.length > 0) {
      q = q.in('brand_id', realIds);
    } else if (hasUncategorized) {
      q = q.is('brand_id', null);
    }
  }

  if (filters.ops === 'noUrl') {
    q = q.is('coupang_url', null).is('naver_url', null).is('danawa_url', null);
  } else if (filters.ops === 'partialUrl') {
    // 하나 이상 누락 AND 하나 이상 존재 — .or() 두 번은 AND로 결합된다
    q = q
      .or('coupang_url.is.null,naver_url.is.null,danawa_url.is.null')
      .or('coupang_url.not.is.null,naver_url.not.is.null,danawa_url.not.is.null');
  } else if (filters.ops === 'noBrand') {
    q = q.is('brand_id', null);
  }

  return q;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyProductSort<T extends { order: any }>(
  query: T,
  filters: ProductListFilters
): T {
  const ascending = filters.dir === 'asc';
  let q = query;
  if (filters.sort === 'name') {
    q = q.order('name', { ascending });
  } else if (filters.sort === 'status') {
    q = q.order('is_active', { ascending }).order('created_at', { ascending: false });
  } else {
    q = q.order('created_at', { ascending });
  }
  // 페이지 경계에서 행 중복/누락이 없도록 결정적 tiebreaker
  return q.order('id', { ascending: true });
}
