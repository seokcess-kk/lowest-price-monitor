import type { Page } from 'playwright';
import { parsePrice } from '../utils';

export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/** min~max 사이 랜덤 정수 */
function rand(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

/** min~max ms 사이 랜덤 대기 */
function humanDelay(min: number, max: number): Promise<void> {
  return new Promise((r) => setTimeout(r, rand(min, max)));
}

/**
 * 사람이 페이지를 둘러보는 행동을 시뮬레이션한다.
 * 매번 다른 패턴이 랜덤으로 선택된다.
 */
async function simulateHumanBehavior(page: Page): Promise<void> {
  // 행동 패턴 풀 — 매번 2~4개를 랜덤 선택
  const actions: Array<() => Promise<void>> = [
    // 마우스를 상품 이미지 쪽으로 이동
    async () => {
      await page.mouse.move(rand(100, 500), rand(200, 400), { steps: rand(5, 15) });
      await humanDelay(300, 800);
    },
    // 마우스를 가격 영역 쪽으로 이동
    async () => {
      await page.mouse.move(rand(400, 800), rand(300, 500), { steps: rand(8, 20) });
      await humanDelay(200, 600);
    },
    // 천천히 스크롤 다운
    async () => {
      const scrollAmount = rand(150, 400);
      const scrollSteps = rand(3, 6);
      for (let i = 0; i < scrollSteps; i++) {
        await page.mouse.wheel(0, scrollAmount / scrollSteps);
        await humanDelay(100, 300);
      }
    },
    // 살짝 스크롤 업 (되돌아보기)
    async () => {
      await page.mouse.wheel(0, -rand(50, 150));
      await humanDelay(300, 700);
    },
    // 상품명 근처에 마우스 호버
    async () => {
      const titleEl = await page.$('.prod-buy-header__title, h1, h2');
      if (titleEl) {
        const box = await titleEl.boundingBox();
        if (box) {
          await page.mouse.move(
            box.x + rand(10, Math.min(box.width, 200)),
            box.y + rand(2, Math.min(box.height, 30)),
            { steps: rand(5, 12) },
          );
          await humanDelay(400, 1000);
        }
      }
    },
    // 리뷰/별점 영역 쪽으로 시선 이동
    async () => {
      await page.mouse.move(rand(300, 700), rand(100, 250), { steps: rand(6, 15) });
      await humanDelay(500, 1200);
    },
    // 잠시 멈추기 (읽는 척)
    async () => {
      await humanDelay(800, 2000);
    },
    // 마우스를 옵션 선택 영역으로 이동
    async () => {
      const optionEl = await page.$('.prod-option, .tab-selector, .option-table');
      if (optionEl) {
        const box = await optionEl.boundingBox();
        if (box) {
          await page.mouse.move(
            box.x + rand(20, Math.min(box.width, 150)),
            box.y + rand(5, Math.min(box.height, 40)),
            { steps: rand(8, 18) },
          );
          await humanDelay(300, 800);
        }
      }
    },
  ];

  // 2~4개 랜덤 선택 후 순서 섞기
  const count = rand(2, 5);
  const shuffled = actions.sort(() => Math.random() - 0.5).slice(0, count);

  for (const action of shuffled) {
    await action();
    await humanDelay(200, 600);
  }
}

/**
 * 쿠팡 상품 가격을 Playwright로 직접 수집한다.
 *
 * 필수조건:
 * - headless: false (headless는 Access Denied 차단)
 * - channel: 'chrome' (실제 설치된 Chrome 사용)
 * - launchPersistentContext로 프로필 유지
 * - 로컬 환경에서만 동작 (GitHub Actions 불가)
 */
export async function scrapeCoupang(
  url: string,
  page: Page,
  _productName?: string
): Promise<ScrapeResult | null> {
  // navigator.webdriver 숨기기
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 페이지 로드 후 자연스러운 대기 (1.5~3초)
  await humanDelay(1500, 3000);

  // 사람처럼 페이지 둘러보기
  await simulateHumanBehavior(page);

  // 차단 감지
  const title = await page.title();
  if (title === 'Access Denied') {
    throw new Error('쿠팡 Access Denied - headless: false 필요');
  }

  // 최종 가격 추출 (할인 적용된 가격)
  const finalPriceEl = await page.$('.price-amount.final-price-amount');
  if (finalPriceEl) {
    const text = await finalPriceEl.textContent();
    if (text) {
      const price = parsePrice(text);
      if (price) {
        console.log(`[coupang] 최종가격: ${price}원`);
        return { price, storeName: null };
      }
    }
  }

  // 폴백: 판매가
  const salePriceEl = await page.$('.price-amount.sales-price-amount');
  if (salePriceEl) {
    const text = await salePriceEl.textContent();
    if (text) {
      const price = parsePrice(text);
      if (price) {
        console.log(`[coupang] 판매가격: ${price}원`);
        return { price, storeName: null };
      }
    }
  }

  // 폴백: 가격 컨테이너에서 추출
  const priceContainer = await page.$('.price-container');
  if (priceContainer) {
    const text = await priceContainer.textContent();
    if (text) {
      const match = text.match(/([\d,]+)원/g);
      if (match && match.length > 0) {
        const lastPrice = parsePrice(match[match.length - 1]);
        if (lastPrice) {
          console.log(`[coupang] 컨테이너 가격: ${lastPrice}원`);
          return { price: lastPrice, storeName: null };
        }
      }
    }
  }

  return null;
}
