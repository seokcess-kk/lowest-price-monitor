import { createClient } from '@supabase/supabase-js';
import { computeDominantPrice } from '../src/scraper';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: products } = await supabase
    .from('products')
    .select('id, name, naver_url')
    .eq('is_active', true);
  if (!products) return;

  const { data: logs } = await supabase
    .from('price_logs')
    .select('product_id, channel, price, store_name, is_suspicious, is_manual, collected_at')
    .eq('channel', 'naver')
    .gte('collected_at', sevenDaysAgo)
    .order('collected_at', { ascending: true });

  if (!logs) return;

  const byProduct = new Map<string, typeof logs>();
  for (const l of logs) {
    const arr = byProduct.get(l.product_id) ?? [];
    arr.push(l);
    byProduct.set(l.product_id, arr);
  }

  console.log(`\n=== 네이버 채널 7일 가격 편차 분석 (총 ${products.length}개 상품, ${logs.length} logs) ===\n`);

  const rows: Array<{
    name: string;
    n: number;
    min: number;
    max: number;
    median: number;
    cv: number;
    suspiciousCount: number;
    storeChanges: number;
    distinctStores: string;
  }> = [];

  for (const p of products) {
    const ls = byProduct.get(p.id);
    if (!ls || ls.length === 0) continue;
    const prices = ls.map((l) => l.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const sorted = [...prices].sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length;
    const std = Math.sqrt(variance);
    const cv = mean > 0 ? std / mean : 0;
    const suspiciousCount = ls.filter((l) => l.is_suspicious).length;
    let storeChanges = 0;
    let prevStore: string | null = null;
    for (const l of ls) {
      if (prevStore !== null && l.store_name !== prevStore) storeChanges++;
      prevStore = l.store_name;
    }
    const stores = [...new Set(ls.map((l) => l.store_name ?? 'null'))];
    rows.push({
      name: p.name,
      n: ls.length,
      min,
      max,
      median,
      cv,
      suspiciousCount,
      storeChanges,
      distinctStores: stores.join(','),
    });
  }

  rows.sort((a, b) => b.cv - a.cv);

  for (const r of rows.slice(0, 15)) {
    console.log(
      `[${r.name}]\n` +
        `  n=${r.n}, median=${r.median.toLocaleString()}, min=${r.min.toLocaleString()}, max=${r.max.toLocaleString()}, ` +
        `range=${(((r.max - r.min) / r.median) * 100).toFixed(1)}%, CV=${(r.cv * 100).toFixed(1)}%\n` +
        `  suspicious=${r.suspiciousCount}/${r.n}, storeChanges=${r.storeChanges}, stores=[${r.distinctStores}]`
    );
  }

  console.log('\n=== 가장 변동 큰 상품 1개의 시계열 ===\n');
  const worst = rows[0];
  if (worst) {
    const p = products.find((x) => x.name === worst.name)!;
    const ls = byProduct.get(p.id)!;
    for (const l of ls.slice(-30)) {
      console.log(
        `${l.collected_at} | ${l.price.toLocaleString().padStart(10)}원 | ` +
          `${(l.store_name ?? 'null').padEnd(15)} | susp=${l.is_suspicious} | manual=${l.is_manual}`
      );
    }
  }

  console.log('\n=== 최근 1일 네이버 scrape_errors ===\n');
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: errs } = await supabase
    .from('scrape_errors')
    .select('product_id, error_message, occurred_at')
    .eq('channel', 'naver')
    .gte('occurred_at', oneDayAgo)
    .order('occurred_at', { ascending: false })
    .limit(20);
  for (const e of errs ?? []) {
    const pname = products.find((p) => p.id === e.product_id)?.name ?? '?';
    console.log(`${e.occurred_at} | ${pname} | ${e.error_message}`);
  }

  console.log('\n=== 네이버 is_suspicious=true 최근 20건 ===\n');
  const { data: sus } = await supabase
    .from('price_logs')
    .select('product_id, price, store_name, collected_at')
    .eq('channel', 'naver')
    .eq('is_suspicious', true)
    .gte('collected_at', sevenDaysAgo)
    .order('collected_at', { ascending: false })
    .limit(20);
  for (const s of sus ?? []) {
    const pname = products.find((p) => p.id === s.product_id)?.name ?? '?';
    console.log(`${s.collected_at} | ${pname} | ${s.price.toLocaleString()}원 | ${s.store_name ?? 'null'}`);
  }

  // 신규 baseline 알고리즘(dominantPrice) 검증 + URL 점검 후보 추출.
  //
  // 같은 카탈로그에 단품 판매자가 끼어 있는 상품은 다음 패턴을 보인다:
  //   - 가격이 두 클러스터로 갈라짐 (dominantPrice 대비 어떤 store는 30% 이상 낮은 다른 클러스터)
  //   - 그 저가 클러스터의 store들은 "묶음 단위 = 1개"인 단품 판매자
  //
  // dominantPrice는 묶음(주류) 가격대를 잡고, 거기서 30% 이상 벗어난 store들이 후보.
  console.log('\n=== URL 점검 후보 (단품/묶음 혼입 의심) ===\n');
  const candidates: Array<{
    name: string;
    naverUrl: string | null;
    dominant: number;
    bundleStores: string;
    suspectStores: Array<{ name: string; price: number; ratio: number; n: number }>;
  }> = [];
  for (const p of products) {
    const ls = byProduct.get(p.id);
    if (!ls || ls.length < 4) continue;
    const dominant = computeDominantPrice(ls.map((l) => l.price));
    if (dominant <= 0) continue;

    // store별 가격 집계
    const storeAgg = new Map<string, number[]>();
    for (const l of ls) {
      const key = l.store_name ?? '(null)';
      const arr = storeAgg.get(key) ?? [];
      arr.push(l.price);
      storeAgg.set(key, arr);
    }

    const bundle: string[] = [];
    const suspect: Array<{ name: string; price: number; ratio: number; n: number }> = [];
    for (const [storeName, prices] of storeAgg) {
      const sorted = [...prices].sort((a, b) => a - b);
      const m = sorted[Math.floor(sorted.length / 2)];
      const ratio = (m - dominant) / dominant; // 음수 = baseline보다 저가
      if (Math.abs(ratio) >= 0.3) {
        suspect.push({ name: storeName, price: m, ratio, n: prices.length });
      } else {
        bundle.push(storeName);
      }
    }

    if (suspect.length > 0) {
      candidates.push({
        name: p.name,
        naverUrl: (p as { naver_url?: string | null }).naver_url ?? null,
        dominant,
        bundleStores: bundle.join(','),
        suspectStores: suspect,
      });
    }
  }

  candidates.sort(
    (a, b) =>
      Math.max(...b.suspectStores.map((s) => Math.abs(s.ratio))) -
      Math.max(...a.suspectStores.map((s) => Math.abs(s.ratio)))
  );

  if (candidates.length === 0) {
    console.log('(후보 없음 — 모든 상품의 store 가격대가 dominantPrice ±30% 안)');
  } else {
    for (const c of candidates) {
      console.log(`[${c.name}]`);
      console.log(`  dominantPrice=${c.dominant.toLocaleString()}원, 묶음 추정 store=[${c.bundleStores}]`);
      for (const s of c.suspectStores) {
        const pct = (s.ratio * 100).toFixed(0);
        console.log(`    ! ${s.name}: ${s.price.toLocaleString()}원 (${pct}%, n=${s.n})`);
      }
      if (c.naverUrl) console.log(`  URL: ${c.naverUrl}`);
      console.log('');
    }
    console.log(
      `총 ${candidates.length}개 상품에서 단품/묶음 혼입 의심. 위 URL을 네이버에서 열어 ` +
        `묶음 SKU 카탈로그가 맞는지 확인하고, 단품 판매자가 함께 노출되면 묶음 전용 카탈로그 URL로 교체하세요.`
    );
  }
}

main().catch(console.error);
