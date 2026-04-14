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
    const result = await tryWebUnlocker(url, token, zone);
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

/** Bright Data Web Unlocker로 카탈로그 HTML 받아 파싱 */
async function tryWebUnlocker(
  url: string,
  token: string,
  zone: string
): Promise<ScrapeResult | null> {
  const res = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      zone,
      url,
      format: 'raw',
      country: 'kr',
    }),
  });

  if (!res.ok) {
    console.warn(`[naver] Web Unlocker ${res.status}: ${await res.text().catch(() => '')}`);
    return null;
  }

  const html = await res.text();

  // 차단 페이지 방어 — Bright Data가 뚫지 못한 드문 케이스
  if (html.includes('접속이 일시적으로 제한')) {
    console.warn('[naver] Web Unlocker 응답이 차단 페이지');
    return null;
  }

  // 1순위: 렌더된 DOM의 최저가 판매처 행에서 가격+스토어명 페어링 추출
  const domResult = parseFromDom(html);
  if (domResult) return domResult;

  // 2순위: SSR JSON 직렬화 필드에서 추출 (DOM 구조 변경 대비 폴백)
  return parseFromJsonFallback(html);
}

/**
 * 네이버 카탈로그 페이지의 판매처 행(product_seller_item__)에서
 * `product_is_lowest_price__` modifier가 붙은 행만 선택해
 * 같은 행의 판매처명(product_name__)과 가격(product_num__)을 함께 추출.
 *
 * React CSS Modules 해시는 빌드마다 바뀔 수 있지만 접두사는 안정적.
 */
function parseFromDom(html: string): ScrapeResult | null {
  const parts = html.split(/class="product_seller_item__[^"]*"/);
  if (parts.length < 2) return null;

  for (const block of parts.slice(1)) {
    if (!block.includes('product_is_lowest_price__')) continue;

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
