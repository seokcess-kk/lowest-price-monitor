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
 *
 * Web Unlocker가 쿠팡에 대해 200 OK + 빈/짧은 본문이나 타임아웃을 자주 돌려준다
 * (실측: 호출의 ~35%가 빈 응답 또는 60초 타임아웃). 빈 응답은 보통 빨리 돌아오고,
 * 재요청 시 Bright Data가 다른 우회 경로를 잡아 성공하는 경우가 많다.
 *
 * 그래서 "고정 횟수 재시도" 대신 "총 시간 예산" 방식으로 재시도한다:
 *   - 빈 응답(빠름)이 반복되면 예산 안에서 여러 번 더 시도 → 성공 확률↑
 *   - 60초 타임아웃이 예산을 빠르게 소진하면 일찍 포기 → 워커가 한 상품에 과도하게 묶이지 않음
 * 동시에 도는 다른 쿠팡 호출과 재시도 박자가 겹쳐 zone 큐에 몰리지 않도록 지터 백오프를 둔다.
 */
/**
 * 기본 재시도 상한. 빈 응답 35%를 독립사건으로 보면 3회로 성공률 ~96%를 유지하면서
 * (5회는 ~99.5%) 장애 시 낭비 호출을 40% 줄인다. 상품 등급별로 collectAll이 opts로 조정한다.
 */
const DEFAULT_MAX_FETCH_ATTEMPTS = 3;
/** 한 상품의 쿠팡 수집에 쓸 수 있는 총 시간(재시도 포함). 초과 시 더는 시도하지 않는다. */
const TOTAL_FETCH_BUDGET_MS = 150_000;
/** 한 번의 Web Unlocker 호출 상한 (정상 응답이 ~53초까지도 걸려 60초 유지). */
const ATTEMPT_TIMEOUT_MS = 60_000;
const RETRY_BACKOFF_BASE_MS = 1_000;
const RETRY_BACKOFF_MAX_MS = 4_000;
const MIN_HTML_BYTES = 5_000;

export async function scrapeCoupang(
  url: string,
  opts?: { maxAttempts?: number }
): Promise<ScrapeResult | null> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? DEFAULT_MAX_FETCH_ATTEMPTS);
  let html = '';
  const startedAt = Date.now();
  let attempt = 0; // 실제 callWebUnlocker 호출 횟수

  while (attempt < maxAttempts) {
    // 남은 예산이 한 번의 의미 있는 시도에도 못 미치면 중단.
    // (백오프보다 먼저 확인 — 어차피 호출하지 못할 시도의 백오프로 워커를 묶지 않도록)
    if (TOTAL_FETCH_BUDGET_MS - (Date.now() - startedAt) < 5_000) {
      console.warn(`[coupang] 재시도 예산 소진 (${attempt}회 시도)`);
      break;
    }
    if (attempt > 0) {
      // 지터 섞은 백오프 — 동시 실행되는 쿠팡 호출들의 재시도가 한 박자로 몰리는 것을 분산
      const backoff = Math.min(RETRY_BACKOFF_BASE_MS * (attempt + 1), RETRY_BACKOFF_MAX_MS);
      const jitter = Math.floor(Math.random() * RETRY_BACKOFF_BASE_MS);
      await new Promise((r) => setTimeout(r, backoff + jitter));
    }

    // 백오프로 시간이 더 흘렀을 수 있어 timeout은 현재 남은 예산 기준으로 다시 계산
    const timeoutMs = Math.min(
      ATTEMPT_TIMEOUT_MS,
      Math.max(5_000, TOTAL_FETCH_BUDGET_MS - (Date.now() - startedAt))
    );
    attempt++;

    const res = await callWebUnlocker({ channel: 'coupang', url, timeoutMs });
    if (!res.ok) {
      console.warn(`[coupang] Web Unlocker ${res.status} (attempt ${attempt})`);
      continue;
    }
    const body = res.text ?? '';
    if (body.includes('차단된 접근입니다')) {
      console.warn(`[coupang] 차단 페이지 (attempt ${attempt})`);
      continue;
    }
    if (body.length < MIN_HTML_BYTES) {
      console.warn(
        `[coupang] 빈/짧은 응답 ${body.length}B (attempt ${attempt})`
      );
      continue;
    }
    html = body;
    break;
  }

  if (!html) {
    console.warn(`[coupang] ${attempt}회 시도 모두 유효 HTML 확보 실패`);
    return null;
  }

  // 1순위: JSON-LD Schema.org Product
  const ldResult = parseFromJsonLd(html);
  if (ldResult) return ldResult;

  // 2순위: 렌더된 DOM의 최종 가격 요소
  console.warn('[coupang] JSON-LD 파싱 실패 — DOM 폴백 시도');
  const domResult = parseFromDom(html);
  if (domResult) return domResult;

  // 가격을 못 찾은 경우, 품절이면 구체 사유로 throw 한다 (상위 collectAll이 error_message로 기록).
  // 품절 페이지는 JSON-LD Product도 final-price 요소도 없어 여기까지 떨어진다.
  if (isSoldOut(html)) {
    throw new Error('쿠팡 품절');
  }

  return null;
}

/**
 * 쿠팡 품절 여부. 구매 버튼이 "품절"/"일시품절"/"판매 종료"를 렌더하는 경우만 인정한다.
 * 페이지 i18n 사전(`...":"일시품절"`)에 해당 문자열이 항상 포함돼 전역 검색은 오탐이므로,
 * 구매 버튼 클래스(find-known__buy__button)에 앵커링한다. (클래스 해시 접미사는 없음)
 */
function isSoldOut(html: string): boolean {
  return /find-known__buy__button[^>]*>\s*(?:일시품절|품절|판매\s*종료)/.test(html);
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
