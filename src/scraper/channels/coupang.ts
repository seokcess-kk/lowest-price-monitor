import type { Page } from 'playwright';
import crypto from 'crypto';

export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/**
 * 쿠팡 파트너스 API를 사용하여 상품 가격을 조회한다.
 * 상품명으로 검색하여 가격을 가져온다.
 * store_name은 항상 null (쿠팡 직접 판매)
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

  const apiPath = `/v2/providers/affiliate_open_api/apis/openapi/products/search?keyword=${encodeURIComponent(productName)}&limit=5`;
  const auth = generateCoupangHmac('GET', apiPath, accessKey, secretKey);
  const apiUrl = `https://api-gateway.coupang.com${apiPath}`;

  const res = await fetch(apiUrl, {
    headers: { 'Authorization': auth },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`쿠팡 API 실패 (${res.status}): ${text.substring(0, 200)}`);
  }

  const data = await res.json();
  const products = data?.data?.productData;

  if (!products || products.length === 0) {
    throw new Error(`쿠팡 API 검색 결과 없음: "${productName}"`);
  }

  // URL에서 상품 ID 추출하여 일치하는 항목 찾기
  const productId = extractProductId(url);
  const match = productId
    ? products.find((p: { productId: number }) => String(p.productId) === productId)
    : null;

  // 일치하는 상품이 있으면 사용, 없으면 최저가 상품 사용
  const selected = match || products[0];
  const price = Math.round(selected.productPrice);

  if (!price || price <= 0) {
    throw new Error('쿠팡 API 가격 데이터 없음');
  }

  return { price, storeName: null };
}

/** URL에서 쿠팡 상품 ID 추출 */
function extractProductId(url: string): string | null {
  const match = url.match(/products\/(\d+)/);
  return match ? match[1] : null;
}

/** 쿠팡 파트너스 API HMAC 서명 생성 */
function generateCoupangHmac(
  method: string,
  urlPath: string,
  accessKey: string,
  secretKey: string
): string {
  const [path, ...queryParts] = urlPath.split('?');
  const query = queryParts.length > 0 ? queryParts.join('?') : '';

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const datetime =
    String(now.getUTCFullYear()).slice(2) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    'T' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds()) +
    'Z';

  const message = datetime + method + path + query;
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('hex');

  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}
