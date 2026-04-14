export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/**
 * 다나와 가격비교 페이지에서 최저가를 수집한다.
 * Bright Data Web Unlocker 경유 → HTML 문자열 파싱.
 *
 * DOM 구조 (판매처 행):
 *   <li class="list-item">
 *     <div class="box__logo"><img class='image' alt='11번가'></div>
 *     <div class="box__price lowest">            ← 최저가 modifier
 *       <span class="text__num">18,300</span>
 *     </div>
 *   </li>
 *
 * `list-item` 클래스가 GNB 메뉴에도 쓰이므로 box__logo + text__num 포함 여부로 필터링.
 * 속성 따옴표는 작은/큰 둘 다 허용.
 */
export async function scrapeDanawa(url: string): Promise<ScrapeResult | null> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const zone = process.env.BRIGHTDATA_ZONE;

  if (!token || !zone) {
    throw new Error(
      'BRIGHTDATA_API_TOKEN / BRIGHTDATA_ZONE 환경 변수가 설정되지 않았습니다'
    );
  }

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
    console.warn(`[danawa] Web Unlocker ${res.status}: ${await res.text().catch(() => '')}`);
    return null;
  }

  const html = await res.text();
  if (html.length < 5_000) {
    console.warn('[danawa] 응답 크기가 비정상적으로 작음');
    return null;
  }

  return parseFromHtml(html);
}

function parseFromHtml(html: string): ScrapeResult | null {
  const rows = html
    .split(/<li class="list-item"/)
    .slice(1)
    .filter((r) => r.includes('box__logo') && r.includes('text__num'));

  const parsed: Array<{ isLowest: boolean; price: number; storeName: string }> = [];
  for (const row of rows) {
    const isLowest = /class=["']box__price lowest/.test(row);
    const priceMatch = row.match(/class=["']text__num["'][^>]*>([\d,]+)</);
    const mallMatch = row.match(/class=["']image["'][^>]*alt=["']([^"']+)["']/);
    if (!priceMatch || !mallMatch) continue;
    const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
    if (!Number.isFinite(price) || price <= 0) continue;
    parsed.push({
      isLowest,
      price,
      storeName: decodeHtmlEntities(mallMatch[1]),
    });
  }

  if (parsed.length === 0) return null;

  // 1순위: 다나와가 명시한 최저가 행
  const marked = parsed.find((r) => r.isLowest);
  if (marked) return { price: marked.price, storeName: marked.storeName };

  // 2순위: 전체 중 최저가
  const cheapest = parsed.reduce((min, curr) => (curr.price < min.price ? curr : min));
  return { price: cheapest.price, storeName: cheapest.storeName };
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
