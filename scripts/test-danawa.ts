import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'ko-KR',
  });

  const items = [
    { name: '돈카츠', pcode: '9575343' },
    { name: '고추장', pcode: '4715169' },
    { name: '핫도그', pcode: '96851162' },
  ];

  for (const item of items) {
    const page = await ctx.newPage();
    await page.goto(`https://prod.danawa.com/info/?pcode=${item.pcode}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const topEl = document.querySelector('a.link__sell-price') as HTMLElement;
      const topPrice = topEl?.textContent?.trim() || null;
      const fi = document.querySelector('.diff_item:first-child');
      const fiPrice = fi?.querySelector('.prc_c')?.textContent?.trim() || null;
      const fiMall = (fi?.querySelector('.d_mall img') as HTMLImageElement)?.alt || null;
      return { topPrice, fiPrice, fiMall };
    });

    console.log(`${item.name}: 최저가=${data.topPrice}, 리스트가격=${data.fiPrice}, 스토어=${data.fiMall}`);
    await page.close();
  }

  await browser.close();
}

main().catch(console.error);
