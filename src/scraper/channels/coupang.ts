import type { Page } from 'playwright';
import crypto from 'crypto';

export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/**
 * 쿠팡 파트너스 API로 상품 가격을 조회한다.
 *
 * 매칭 전략:
 * 1. coupang_url에서 productId 추출
 * 2. 상품명 핵심 키워드로 API 검색 (limit=10)
 * 3. 검색 결과에서 productId가 일치하는 상품의 최저가 반환
 */
export async function scrapeCoupang(
  url: string,
  _page: Page,
  productName?: string
): Promise<ScrapeResult | null> {
  const accessKey = process.env.COUPANG_ACCESS_KEY;
  const secretKey = process.env.COUPANG_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new Error('COUPANG_ACCESS_KEY 또는 COUPANG_SECRET_KEY가 설정되지 않았습니다');
  }

  if (!productName) {
    throw new Error('쿠팡 API 검색에는 상품명이 필요합니다');
  }

  const targetId = extractProductId(url);
  if (!targetId) {
    throw new Error(`쿠팡 URL에서 상품 ID를 추출할 수 없음: ${url}`);
  }

  for (const keyword of buildKeywords(productName)) {
    const result = await searchAndMatch(keyword, targetId, accessKey, secretKey);
    if (result) return result;
  }

  throw new Error(`쿠팡 API에서 상품을 찾을 수 없음 (productId: ${targetId})`);
}

/** URL에서 상품 ID 추출: /products/257809438 → 257809438 */
function extractProductId(url: string): number | null {
  const m = url.match(/\/products\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 상품명에서 핵심 검색 키워드 생성 (용량/수량 제거) */
function buildKeywords(name: string): string[] {
  const core = name
    .replace(/\s*[x×]\s*\d+\s*개?/gi, '')
    .replace(/\s*\(총\s*\d+개?\)/g, '')
    .replace(/\d+[gG㎖mMlLkK]+/g, '')
    .replace(/%/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const keywords = [core];
  if (core !== name) keywords.push(name);
  return keywords;
}

/** 키워드 검색 → productId 매칭 → 최저가 반환 */
async function searchAndMatch(
  keyword: string,
  targetId: number,
  accessKey: string,
  secretKey: string,
  retry = 0
): Promise<ScrapeResult | null> {
  const apiPath = `/v2/providers/affiliate_open_api/apis/openapi/products/search?keyword=${encodeURIComponent(keyword)}&limit=10`;
  const res = await fetch(`https://api-gateway.coupang.com${apiPath}`, {
    headers: { Authorization: hmac('GET', apiPath, accessKey, secretKey) },
  });

  if (!res.ok) return null;
  const data = await res.json();

  // rate limit (최대 2회 재시도)
  if ((data.rCode === '400' || data.rCode === 400) && retry < 2) {
    console.log(`[coupang] rate limit, 5초 대기 (${retry + 1}/2)`);
    await new Promise((r) => setTimeout(r, 5000));
    return searchAndMatch(keyword, targetId, accessKey, secretKey, retry + 1);
  }

  const products: any[] = data?.data?.productData || [];
  if (products.length === 0) return null;

  // productId로 매칭
  const matched = products.filter((p) => p.productId === targetId);
  if (matched.length === 0) return null;

  // 매칭된 옵션 중 최저가
  const cheapest = matched.reduce((min, p) =>
    p.productPrice < min.productPrice ? p : min
  );

  console.log(`[coupang] "${keyword}" → productId 매칭 (${matched.length}개 옵션 중 최저가): ${cheapest.productPrice}원`);

  const price = Math.round(cheapest.productPrice);
  return price > 0 ? { price, storeName: null } : null;
}

/** 쿠팡 파트너스 API HMAC 서명 */
function hmac(method: string, urlPath: string, accessKey: string, secretKey: string): string {
  const [path, ...qp] = urlPath.split('?');
  const query = qp.join('?');
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dt =
    String(now.getUTCFullYear()).slice(2) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    'T' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds()) +
    'Z';
  const sig = crypto.createHmac('sha256', secretKey).update(dt + method + path + query).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${dt}, signature=${sig}`;
}
