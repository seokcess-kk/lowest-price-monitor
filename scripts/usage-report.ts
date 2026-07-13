import { createServiceClient } from '../src/lib/supabase';

/**
 * Bright Data 사용량·비용 실측 리포트 (CLI).
 * 실행: npm run usage-report
 *
 * 용도:
 *   1. 저빈도 차등 수집 배포 전후의 일별 호출량 추이 비교 (실제 절감폭 측정)
 *   2. 공식 API 기준 이번달 실제 비용·채널별 분해 (대시보드 값 교차검증)
 *   3. 14일 무변동(저빈도 전환 대상) 채널 규모 — 차등이 잡는 절감 여지
 *
 * 대시보드(src/app/api/brightdata/usage)와 달리 로컬 카운트가 아니라 Bright Data 공식
 * /domains/req·/customer/balance를 신뢰 소스로 쓴다. 로컬 usage_logs는 재시도·무효응답까지
 * 포함해 실제 과금보다 많으므로 "관측치"로만 병기.
 */
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const CPM = Number(process.env.BRIGHTDATA_WEB_UNLOCKER_CPM_USD ?? '') || 1.5;
const channels = ['coupang', 'naver', 'danawa'] as const;
type Ch = (typeof channels)[number];

const sb = createServiceClient();

// supabase 쿼리 빌더 제네릭이 복잡해 최소 shape으로만 제약
interface QueryLike {
  gte: (col: string, v: string) => QueryLike;
  eq: (col: string, v: string | number | boolean) => QueryLike;
  order: (col: string, opts: { ascending: boolean }) => QueryLike;
  range: (
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}

async function fetchAll<T>(
  table: string,
  cols: string,
  apply: (q: QueryLike) => QueryLike
): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await apply(
      sb.from(table).select(cols) as unknown as QueryLike
    ).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/** 최근 N일 일별 호출·성공 추이 — 저빈도 차등 배포 후 호출량이 실제로 꺾이는지 확인 */
async function dailyTrend(days: number): Promise<void> {
  console.log(`\n===== 1. 일별 호출 추이 (최근 ${days}일, KST) =====`);
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const rows = await fetchAll<{ channel: Ch; success: boolean; created_at: string }>(
    'brightdata_usage_logs',
    'channel, success, created_at',
    (q) => q.gte('created_at', since).order('created_at', { ascending: false })
  );
  const daily = new Map<string, { total: number; success: number; byCh: Record<Ch, number> }>();
  for (const r of rows) {
    const d = new Date(new Date(r.created_at).getTime() + KST_OFFSET_MS).toISOString().split('T')[0];
    const e = daily.get(d) ?? { total: 0, success: 0, byCh: { coupang: 0, naver: 0, danawa: 0 } };
    e.total++;
    if (r.success) e.success++;
    if (r.channel in e.byCh) e.byCh[r.channel as Ch]++;
    daily.set(d, e);
  }
  console.log('  날짜         호출   성공 | coupang naver danawa');
  for (const [d, e] of [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(
      `  ${d}  ${String(e.total).padStart(5)} ${String(e.success).padStart(6)} | ` +
        `${String(e.byCh.coupang).padStart(7)} ${String(e.byCh.naver).padStart(5)} ${String(e.byCh.danawa).padStart(6)}`
    );
  }
  console.log('  ※ 저빈도 차등 수집은 배포 다음 크론(익일 08:00 KST)부터 적용 — 그 이후 호출 감소를 확인.');
}

/** 공식 API 기준 이번달 실제 비용 (대시보드와 동일 신뢰 소스) */
async function officialCost(): Promise<void> {
  console.log('\n===== 2. 이번달 실제 비용 (Bright Data 공식) =====');
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const zone = process.env.BRIGHTDATA_ZONE;
  if (!token || !zone) {
    console.log('  BRIGHTDATA_API_TOKEN / ZONE 미설정 — 공식 조회 skip');
    return;
  }
  const now = new Date();
  const from = `${now.toISOString().slice(0, 7)}-01`;
  const to = now.toISOString().split('T')[0];

  try {
    const balRes = await fetch('https://api.brightdata.com/customer/balance', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const bal = (await balRes.json()) as Record<string, number>;
    console.log(
      `  잔액 $${bal.balance ?? '-'} | 미청구 비용(pending_costs) $${bal.pending_costs ?? '-'}  ← 이번달 실제 소진`
    );
  } catch (e) {
    console.log('  [balance] 실패:', e instanceof Error ? e.message : e);
  }

  try {
    const res = await fetch(
      `https://api.brightdata.com/domains/req?from=${from}&to=${to}&zones=${encodeURIComponent(zone)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) }
    );
    const raw = (await res.json()) as Record<string, unknown>;
    const perCh = new Map<Ch, number>();
    let grand = 0;
    const toChannel = (domain: string): Ch | null =>
      domain === 'coupang.com'
        ? 'coupang'
        : domain === 'danawa.com'
          ? 'danawa'
          : domain === 'naver.com' || domain === 'search.shopping.naver.com'
            ? 'naver'
            : null;
    for (const zoneObj of Object.values(raw)) {
      for (const dateObj of Object.values((zoneObj ?? {}) as Record<string, unknown>)) {
        for (const [domain, cnt] of Object.entries(dateObj as Record<string, number>)) {
          const ch = toChannel(domain);
          if (!ch) continue;
          perCh.set(ch, (perCh.get(ch) ?? 0) + Number(cnt));
          grand += Number(cnt);
        }
      }
    }
    console.log(`  공식 과금 요청 (${from}~${to}):`);
    for (const ch of channels) {
      const c = perCh.get(ch) ?? 0;
      console.log(`    ${ch.padEnd(8)} ${String(c).padStart(6)}건  $${((c / 1000) * CPM).toFixed(2)}`);
    }
    console.log(`    ${'합계'.padEnd(7)} ${String(grand).padStart(6)}건  $${((grand / 1000) * CPM).toFixed(2)}  (CPM $${CPM}/1K)`);
  } catch (e) {
    console.log('  [/domains/req] 실패:', e instanceof Error ? e.message : e);
  }
}

/** 14일 무변동(저빈도 전환 대상) 규모 — src/scraper/index.ts 게이트와 동일 판정 로직 */
async function lowFreqTargets(): Promise<void> {
  console.log('\n===== 3. 저빈도 차등 대상 (14일 무변동) =====');
  const prods = await fetchAll<{
    id: string;
    coupang_url: string | null;
    naver_url: string | null;
    danawa_url: string | null;
  }>('products', 'id,coupang_url,naver_url,danawa_url', (q) => q.eq('is_active', true));

  const logs = await fetchAll<{ product_id: string; channel: Ch; price: number; collected_at: string }>(
    'price_logs',
    'product_id,channel,price,collected_at',
    (q) => q.eq('is_suspicious', false).gte('collected_at', new Date(Date.now() - 15 * DAY_MS).toISOString())
  );
  const hist = new Map<string, number[]>();
  const cutoff = Date.now() - 14 * DAY_MS;
  for (const r of logs) {
    const t = new Date(r.collected_at).getTime();
    if (t < cutoff) continue;
    const key = `${r.product_id}:${r.channel}`;
    const arr = hist.get(key) ?? [];
    arr.push(r.price);
    hist.set(key, arr);
  }
  const urlOf = (p: (typeof prods)[number], ch: Ch) =>
    ch === 'coupang' ? p.coupang_url : ch === 'naver' ? p.naver_url : p.danawa_url;

  let active = 0;
  let flat = 0;
  const flatBy: Record<Ch, number> = { coupang: 0, naver: 0, danawa: 0 };
  for (const p of prods) {
    for (const ch of channels) {
      if (!urlOf(p, ch)) continue;
      active++;
      const prices = hist.get(`${p.id}:${ch}`);
      if (prices && prices.length >= 2 && Math.min(...prices) === Math.max(...prices)) {
        flat++;
        flatBy[ch]++;
      }
    }
  }
  const pct = active ? ((flat / active) * 100).toFixed(1) : '-';
  console.log(`  활성 채널: ${active}개`);
  console.log(`  14일 무변동(3일주기 전환): ${flat}개 (${pct}%) — coupang ${flatBy.coupang}, naver ${flatBy.naver}, danawa ${flatBy.danawa}`);
  const longTermSaved = Math.round(flat * (1 - 1 / 3));
  console.log(`  → 장기 평균 절감 추정: 일 채널호출 약 ${longTermSaved}개 감소 (쿠팡은 재시도 곱셈으로 실제 절감 더 큼)`);
}

async function main(): Promise<void> {
  console.log('=== Bright Data 사용량·비용 리포트 ===', new Date().toISOString());
  await dailyTrend(14);
  await officialCost();
  await lowFreqTargets();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('리포트 실패:', e);
    process.exit(1);
  });
