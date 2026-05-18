/**
 * 지금 Bright Data Web Unlocker가 살아 있는지 직접 확인.
 * 쿠팡 / 네이버 / 다나와 각 1개씩 호출해서 status / body 앞 200자만 출력.
 * 과금/zone 이슈면 200+0B가 아니라 401/402/403 + 에러 JSON이 나올 가능성.
 */
async function main() {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const zone = process.env.BRIGHTDATA_ZONE;
  if (!token || !zone) {
    console.error('환경변수 누락');
    process.exit(1);
  }
  console.log(`[zone] ${zone}\n`);

  const targets = [
    { ch: 'coupang', url: 'https://www.coupang.com/vp/products/7960828570' },
    { ch: 'naver', url: 'https://search.shopping.naver.com/catalog/35349319456' },
    { ch: 'danawa', url: 'https://prod.danawa.com/info/?pcode=1234567' },
  ];

  for (const t of targets) {
    const start = Date.now();
    try {
      const res = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ zone, url: t.url, format: 'raw', country: 'kr' }),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      const dur = Date.now() - start;
      console.log(`[${t.ch}] status=${res.status} ok=${res.ok} bytes=${text.length} dur=${dur}ms`);
      console.log(`  앞 300자: ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
      // 핵심 헤더
      const ct = res.headers.get('content-type');
      const xBd = res.headers.get('x-brd-err-code') ?? res.headers.get('x-brd-error');
      console.log(`  content-type=${ct}  x-brd-err=${xBd}\n`);
    } catch (e) {
      console.log(`[${t.ch}] 예외: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
}
main();
