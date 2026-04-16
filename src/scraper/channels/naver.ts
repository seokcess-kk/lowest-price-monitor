import { callWebUnlocker } from '../brightdata';

export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/**
 * 네이버 쇼핑 카탈로그 페이지에서 최저가를 수집한다.
 * Bright Data Web Unlocker API 경유 — 로컬/서버 어디서나 동작, 차단 우회는 Bright Data 담당.
 *
 * 흐름:
 *   1. Web Unlocker에 POST → 차단 우회된 HTML 수신
 *   2. HTML 내부의 SSR 직렬화 JSON에서 "lowestPrice" / "mallName" 추출
 *   3. API 키/zone 미설정 시 네이버 검색 API 폴백
 *
 * _page 파라미터는 공용 시그니처 호환용이며 사용하지 않음 (fetch 기반).
 */
export async function scrapeNaver(
  url: string,
  productName?: string
): Promise<ScrapeResult | null> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const zone = process.env.BRIGHTDATA_ZONE;

  if (token && zone) {
    const result = await tryWebUnlocker(url);
    if (result) return result;
    console.warn('[naver] Web Unlocker HTML 수신 후 가격 파싱 실패 — API 폴백 시도');
  } else {
    console.warn('[naver] BRIGHTDATA_API_TOKEN / BRIGHTDATA_ZONE 미설정 — API 폴백 사용');
  }

  // 폴백: 네이버 쇼핑 검색 API
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (clientId && clientSecret && productName) {
    const apiResult = await trySearchApi(productName, clientId, clientSecret);
    if (apiResult) {
      console.log('[naver] API 폴백 사용');
      return apiResult;
    }
  }

  throw new Error('네이버 수집 실패 — Web Unlocker와 API 폴백 모두 실패');
}

/** URL에서 네이버 카탈로그 ID 추출 (예: /catalog/53668153183 → "53668153183") */
function extractCatalogId(url: string): string | null {
  const m = url.match(/\/catalog\/(\d+)/);
  return m ? m[1] : null;
}

/** Bright Data Web Unlocker로 카탈로그 HTML 받아 파싱 */
async function tryWebUnlocker(url: string): Promise<ScrapeResult | null> {
  const res = await callWebUnlocker({ channel: 'naver', url });

  if (!res.ok) {
    console.warn(`[naver] Web Unlocker ${res.status}`);
    return null;
  }

  const html = res.text ?? '';

  // 차단 페이지 방어 — Bright Data가 뚫지 못한 드문 케이스
  if (html.includes('접속이 일시적으로 제한')) {
    console.warn('[naver] Web Unlocker 응답이 차단 페이지');
    return null;
  }

  const catalogId = extractCatalogId(url);

  // 1순위: 카탈로그 요약 블록(catalog_summary_info)에서 직접 최저가/판매처 추출
  const summaryResult = parseFromSummary(html);
  if (summaryResult) return summaryResult;

  // 2순위: 판매처 리스트의 최저가 행에서 가격+스토어명 페어링 추출
  const domResult = parseFromDom(html, catalogId);
  if (domResult) return domResult;

  // 3순위: SSR JSON 직렬화 필드에서 추출 (DOM 구조 변경 대비 폴백)
  return parseFromJsonFallback(html);
}

/**
 * 카탈로그 페이지 상단 요약 블록에서 최저가와 판매처를 뽑는다.
 *
 *   <div id="catalog_summary_info" ...>
 *     ...
 *     <strong class="catalogLowestPrice_num__...">20,380</strong>원
 *     ...
 *     <span class="catalogLowestMall_name__...">11번가</span>
 *
 * 네이버가 직접 확정한 최저가/판매처라 판매처 리스트를 훑는 것보다
 * 광고·카드할인·옵션가 혼입에 강하다.
 */
function parseFromSummary(html: string): ScrapeResult | null {
  const summaryIdx = html.indexOf('id="catalog_summary_info"');
  if (summaryIdx < 0) return null;

  // 요약 블록 이후 영역(추천 판매처 직전까지)만 대상으로 좁힌다
  const scopeEnd = html.indexOf('buyBoxProducts_recommend_product_area', summaryIdx);
  const scope = html.slice(summaryIdx, scopeEnd > 0 ? scopeEnd : summaryIdx + 20000);

  const priceMatch = scope.match(/class="catalogLowestPrice_num__[^"]*"[^>]*>([\d,]+)</);
  if (!priceMatch) return null;
  const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
  if (!Number.isFinite(price) || price <= 0) return null;

  const mallMatch = scope.match(/class="catalogLowestMall_name__[^"]*"[^>]*>([^<]+)</);
  const storeName = mallMatch ? mallMatch[1].trim() : null;

  return { price, storeName };
}

/**
 * 네이버 카탈로그 페이지의 판매처 행(product_seller_item__)에서
 * `product_is_lowest_price__` modifier가 붙은 행만 선택해
 * 같은 행의 판매처명(product_name__)과 가격(product_num__)을 함께 추출.
 *
 * 광고 블록(PLA)과 연관 상품 카드가 같은 클래스 구조를 쓰므로 다음 기준으로 필터:
 *   1. `data-shp-sti="ad"` 또는 'adcr.' 광고 링크 포함 블록 → 제외
 *   2. catalogId가 주어지면, 블록의 `catalog_nv_mid`가 다른 카탈로그를
 *      가리키면 제외 (광고주의 다른 카탈로그로 유도하는 경우 방어)
 *
 * React CSS Modules 해시는 빌드마다 바뀔 수 있지만 접두사는 안정적.
 */
function parseFromDom(html: string, catalogId: string | null): ScrapeResult | null {
  const parts = html.split(/class="product_seller_item__[^"]*"/);
  if (parts.length < 2) return null;

  for (const block of parts.slice(1)) {
    if (!block.includes('product_is_lowest_price__')) continue;

    // 광고 블록 제외
    if (/data-shp-sti=(?:"|&quot;)ad(?:"|&quot;)/.test(block)) continue;
    if (block.includes('adcr.shopping.naver.com')) continue;

    // 카탈로그 ID 불일치 블록 제외 (광고주의 다른 카탈로그)
    if (catalogId) {
      const blockCatalogMatch = block.match(
        /catalog_nv_mid(?:"|&quot;)?,\s*(?:"|&quot;)?value(?:"|&quot;)?:(?:"|&quot;)?(\d+)/
      );
      if (blockCatalogMatch && blockCatalogMatch[1] !== catalogId) continue;
    }

    const nameMatch = block.match(/class="product_name__[^"]*"[^>]*>([^<]+)</);
    const priceMatch = block.match(/class="product_num__[^"]*"[^>]*>([\d,]+)</);
    if (!nameMatch || !priceMatch) continue;

    const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
    if (!Number.isFinite(price) || price <= 0) continue;

    return { price, storeName: nameMatch[1].trim() };
  }

  return null;
}

/**
 * SSR JSON 폴백 — DOM 구조가 바뀌었거나 최저가 modifier를 못 찾은 경우.
 * lowestPriceWithFee 값이 있는 mallName을 투표 집계해 최다 빈도 후보 반환.
 */
function parseFromJsonFallback(html: string): ScrapeResult | null {
  let priceMatch = html.match(/lowestPriceWithFee\\?"?\s*:\s*(\d+)/);
  if (!priceMatch) {
    priceMatch = html.match(/[^\w]lowestPrice\\?"?\s*:\s*(\d+)/);
  }
  if (!priceMatch) return null;
  const price = parseInt(priceMatch[1], 10);
  if (!Number.isFinite(price) || price <= 0) return null;

  const mallList = [...html.matchAll(/mallName\\?"?\s*:\s*\\?"([^"\\]{1,50})/g)].map(
    (m) => ({ idx: m.index ?? 0, name: m[1] })
  );
  if (mallList.length === 0) return { price, storeName: null };

  const priceRegex = new RegExp(
    `(?:lowestPrice|price)\\\\?"?\\s*:\\s*${priceMatch[1]}(?![0-9])`,
    'g'
  );
  const priceHits = [...html.matchAll(priceRegex)];
  if (priceHits.length === 0) return { price, storeName: mallList[0].name };

  const counts = new Map<string, number>();
  for (const ph of priceHits) {
    const idx = ph.index ?? 0;
    const before = [...mallList].reverse().find((m) => m.idx < idx);
    const after = mallList.find((m) => m.idx > idx);
    const nearest =
      before && after
        ? idx - before.idx <= after.idx - idx
          ? before
          : after
        : before || after;
    if (nearest) counts.set(nearest.name, (counts.get(nearest.name) || 0) + 1);
  }

  if (counts.size === 0) return { price, storeName: mallList[0].name };
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  return { price, storeName: top[0] };
}

/** 네이버 쇼핑 검색 API 폴백 */
async function trySearchApi(
  productName: string,
  clientId: string,
  clientSecret: string
): Promise<ScrapeResult | null> {
  try {
    const apiUrl = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(productName)}&display=5&sort=asc&exclude=used`;
    const res = await fetch(apiUrl, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.items || data.items.length === 0) return null;

    const item = data.items[0];
    const price = parseInt(item.lprice, 10);
    if (!price || price <= 0) return null;

    return { price, storeName: item.mallName || null };
  } catch {
    return null;
  }
}
