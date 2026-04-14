import { callWebUnlocker } from '../brightdata';

export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/**
 * 쿠팡 상품 페이지에서 최저가를 수집한다.
 * Bright Data Web Unlocker 경유 → HTML → Schema.org Product JSON-LD → offers.price.
 *
 * 이전에는 쿠팡 파트너스 API를 썼으나, 파트너스 API 가격이 웹사이트 실제 판매가와
 * 달라(와우·쿠폰 할인 미반영) 정확도 문제가 있어 Web Unlocker 방식으로 전환.
 */
export async function scrapeCoupang(url: string): Promise<ScrapeResult | null> {
  const res = await callWebUnlocker({ channel: 'coupang', url });

  if (!res.ok) {
    console.warn(`[coupang] Web Unlocker ${res.status}`);
    return null;
  }

  const html = res.text ?? '';

  // 차단 페이지 방어
  if (html.includes('차단된 접근입니다') || html.length < 5_000) {
    console.warn('[coupang] 차단/빈 응답 감지');
    return null;
  }

  // 1순위: JSON-LD Schema.org Product
  const ldResult = parseFromJsonLd(html);
  if (ldResult) return ldResult;

  // 2순위: 렌더된 DOM의 최종 가격 요소
  console.warn('[coupang] JSON-LD 파싱 실패 — DOM 폴백 시도');
  return parseFromDom(html);
}

/**
 * HTML 내 `<script type="application/ld+json">` 태그에서 Product 스키마를 찾아
 * offers.price를 실제 판매가로 사용한다. 취소선(strikethrough) 원가는 무시.
 */
function parseFromJsonLd(html: string): ScrapeResult | null {
  const scriptRegex =
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

  for (const match of html.matchAll(scriptRegex)) {
    try {
      const data = JSON.parse(match[1]);
      if (data['@type'] !== 'Product') continue;

      const raw = data?.offers?.price;
      const price = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
      if (!Number.isFinite(price) || price <= 0) continue;

      return { price, storeName: null };
    } catch {
      continue;
    }
  }

  console.warn('[coupang] JSON-LD에서 Product offers.price 찾지 못함');
  return null;
}

/**
 * DOM 폴백: `.price-amount.final-price-amount` 요소의 텍스트에서 가격 추출.
 * JSON-LD가 없거나 offers.price 필드 누락 시 사용.
 */
function parseFromDom(html: string): ScrapeResult | null {
  const match = html.match(
    /class="[^"]*\bfinal-price-amount\b[^"]*"[^>]*>([^<]+)</
  );
  if (!match) return null;

  const digits = match[1].replace(/[^0-9]/g, '');
  if (!digits) return null;

  const price = parseInt(digits, 10);
  if (!Number.isFinite(price) || price <= 0) return null;

  return { price, storeName: null };
}
