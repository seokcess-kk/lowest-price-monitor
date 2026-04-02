import { chromium } from 'playwright';
import { scrapeCoupang } from '../src/scraper/channels/coupang';
import { scrapeNaver } from '../src/scraper/channels/naver';
import { scrapeDanawa } from '../src/scraper/channels/danawa';

process.env.COUPANG_ACCESS_KEY = '5261149a-5482-4cfc-a919-e5d3bc512cc9';
process.env.COUPANG_SECRET_KEY = 'a711e80f250d66021a965c1500c1cd5de375cef7';
process.env.NAVER_CLIENT_ID = 'TjLuYXAtlHEYSTDsp440';
process.env.NAVER_CLIENT_SECRET = '1A0MhP2soq';

const TEST_PRODUCTS = [
  {
    name: '고메 바삭튀겨낸 통등심 돈카츠 450g x3개',
    coupang: 'https://www.coupang.com/vp/products/257809438?itemId=19224744642',
    naver: 'https://search.shopping.naver.com/catalog/55078677000',
    danawa: 'https://prod.danawa.com/info/?pcode=9575343',
  },
  {
    name: '해찬들 100% 우리쌀로 만든 태양초 고추장 1kg x2개',
    coupang: 'https://www.coupang.com/vp/products/8402118556?itemId=19737688386',
    naver: 'https://search.shopping.naver.com/catalog/51929490028',
    danawa: 'https://prod.danawa.com/info/?pcode=4715169',
  },
  {
    name: '고메 오리지널 핫도그 400g x4개(총 20개)',
    coupang: 'https://www.coupang.com/vp/products/6226421884?itemId=23883946809',
    naver: 'https://search.shopping.naver.com/catalog/53668153183',
    danawa: 'https://prod.danawa.com/info/?pcode=96851162',
  },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'ko-KR',
  });

  for (const product of TEST_PRODUCTS) {
    console.log(`\n=== ${product.name} ===`);

    for (const [channel, url, scraper] of [
      ['쿠팡', product.coupang, scrapeCoupang],
      ['네이버', product.naver, scrapeNaver],
      ['다나와', product.danawa, scrapeDanawa],
    ] as const) {
      const page = await context.newPage();
      try {
        const fn = scraper as (url: string, page: import('playwright').Page, name?: string) => Promise<{ price: number; storeName: string | null } | null>;
        const result = await fn(url, page, product.name);
        console.log(`  ${channel}: ${result?.price?.toLocaleString()}원 | 스토어: ${result?.storeName || channel}`);
      } catch (e) {
        console.log(`  ${channel}: 실패 - ${e instanceof Error ? e.message : e}`);
      }
      await page.close();
    }
  }

  await browser.close();
}

main().catch(console.error);
