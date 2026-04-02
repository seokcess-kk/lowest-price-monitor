import type { Page } from 'playwright';
import crypto from 'crypto';

export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/**
 * 쿠팡 파트너스 API로 상품 가격을 조회한다.
 * 상품명으로 검색 → 이름 유사도가 가장 높은 결과의 가격을 반환.
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

  // 검색어 변형 시도
  const searchQueries = generateSearchQueries(productName);

  for (const query of searchQueries) {
    const result = await searchAndMatch(query, productName, accessKey, secretKey);
    if (result) return result;
  }

  throw new Error(`쿠팡 API에서 "${productName}"과 유사한 상품을 찾을 수 없음`);
}

/** 상품명에서 다양한 검색어 생성 (단순한 것부터 시도) */
function generateSearchQueries(productName: string): string[] {
  // 수량 표현 제거한 버전을 먼저 시도 (API 호출 최소화)
  const simplified = productName
    .replace(/\s*[x×]\s*\d+\s*개?/gi, '')
    .replace(/\s*\(총\s*\d+개?\)/g, '')
    .replace(/%/g, '')
    .trim();

  const queries = [simplified];
  if (simplified !== productName) queries.push(productName);

  return queries;
}

/** 검색 후 이름 유사도로 최적 매칭 */
async function searchAndMatch(
  keyword: string,
  originalName: string,
  accessKey: string,
  secretKey: string
): Promise<ScrapeResult | null> {
  const apiPath = `/v2/providers/affiliate_open_api/apis/openapi/products/search?keyword=${encodeURIComponent(keyword)}&limit=20`;
  const auth = generateCoupangHmac('GET', apiPath, accessKey, secretKey);

  const res = await fetch(`https://api-gateway.coupang.com${apiPath}`, {
    headers: { 'Authorization': auth },
  });

  if (!res.ok) return null;

  const data = await res.json();
  console.log(`[coupang] search "${keyword}" → rCode:${data.rCode} count:${data.data?.productData?.length || 0}`);

  // rate limit (rCode 400) 시 5초 대기 후 재시도
  if (data.rCode === '400' || data.rCode === 400) {
    await new Promise((r) => setTimeout(r, 5000));
    const retryRes = await fetch(`https://api-gateway.coupang.com${apiPath}`, {
      headers: { 'Authorization': generateCoupangHmac('GET', apiPath, accessKey, secretKey) },
    });
    if (!retryRes.ok) return null;
    const retryData = await retryRes.json();
    if (retryData.rCode !== '0' && retryData.rCode !== 0) return null;
    return matchBestProduct(retryData.data?.productData, originalName);
  }

  const products = data?.data?.productData;
  if (!products || products.length === 0) return null;

  return matchBestProduct(products, originalName);
}

/** 검색 결과에서 이름 유사도가 가장 높은 상품 매칭 */
function matchBestProduct(
  products: Array<{ productName: string; productPrice: number }> | undefined,
  originalName: string
): ScrapeResult | null {
  if (!products || products.length === 0) return null;

  const normalizedTarget = normalizeProductName(originalName);
  let bestMatch = null;
  let bestScore = 0;

  for (const p of products) {
    const normalizedResult = normalizeProductName(p.productName || '');
    const score = calculateSimilarity(normalizedTarget, normalizedResult);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = p;
    }
  }

  // 유사도 30% 미만이면 매칭 실패
  if (!bestMatch || bestScore < 0.3) return null;

  const price = Math.round(bestMatch.productPrice);
  if (!price || price <= 0) return null;

  return { price, storeName: null };
}

/** 상품명 정규화 (비교용) — 특수문자, 공백, 수량 표현 통일 */
function normalizeProductName(name: string): string {
  return name
    .replace(/[()[\]{}]/g, ' ')      // 괄호를 공백으로
    .replace(/[x×*]/gi, ' ')         // 곱하기 기호를 공백으로
    .replace(/[^가-힣a-zA-Z0-9\s]/g, '') // 나머지 특수문자 제거
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** 두 문자열의 유사도 계산 (부분 문자열 포함 관계 + 공통 단어) */
function calculateSimilarity(a: string, b: string): number {
  // 1. 한쪽이 다른 한쪽을 포함하면 높은 점수
  const aNoSpace = a.replace(/\s/g, '');
  const bNoSpace = b.replace(/\s/g, '');
  if (aNoSpace.includes(bNoSpace) || bNoSpace.includes(aNoSpace)) {
    return 0.9;
  }

  // 2. 공통 단어 비율
  const wordsA = new Set(a.split(' ').filter(w => w.length > 0));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 0));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let commonCount = 0;
  for (const word of wordsA) {
    // 정확히 일치하거나, 한쪽이 다른 쪽을 포함하면 매칭
    for (const wordB of wordsB) {
      if (word === wordB || word.includes(wordB) || wordB.includes(word)) {
        commonCount++;
        break;
      }
    }
  }

  return (commonCount / wordsA.size + commonCount / wordsB.size) / 2;
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
