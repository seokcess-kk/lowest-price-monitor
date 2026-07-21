/**
 * Bright Data "200+0byte 응답이 과금되는가?" 진단 도구.
 *
 * 공식 과금(zone/cost의 reqs_unblocker)을 로컬 brightdata_usage_logs의
 * 응답 크기 버킷(빈=null/0 · 짧음 1~4999 · 정상 ≥5000)과 대조해,
 * 어느 집계가 공식 과금 수와 일치하는지로 0byte 과금 여부를 실증한다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/diagnose-billing.ts
 */
import { createServiceClient } from '../src/lib/supabase';
import { kstMonthBoundaries } from '../src/lib/brightdata-billing';

type Channel = 'coupang' | 'naver' | 'danawa';

function domainToChannel(domain: string): Channel | null {
  switch (domain) {
    case 'coupang.com':
      return 'coupang';
    case 'danawa.com':
    case 'prod.danawa.com':
      return 'danawa';
    case 'naver.com':
    case 'search.shopping.naver.com':
      return 'naver';
    default:
      return null;
  }
}

async function fetchJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function main(): Promise<void> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const zone = process.env.BRIGHTDATA_ZONE;
  if (!token || !zone) {
    console.error('BRIGHTDATA_API_TOKEN / BRIGHTDATA_ZONE 누락');
    process.exit(1);
  }
  const supabase = createServiceClient();

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const from = `${yyyy}-${mm}-01`;
  const to = `${yyyy}-${mm}-${dd}`;
  const { monthStartUtc } = kstMonthBoundaries(now);

  // ── 1. 공식 과금 (확정치) ──
  const cost = (await fetchJson(
    `https://api.brightdata.com/zone/cost?zone=${encodeURIComponent(zone)}&from=${from}&to=${to}`,
    token
  )) as Record<string, { custom?: { cost: number; bw: number; reqs_unblocker: number } }>;
  const costEntry = Object.values(cost)[0]?.custom;
  console.log('===== 1. 공식 과금 (zone/cost) =====');
  console.log(
    `  이번 달 과금 요청(reqs_unblocker) = ${costEntry?.reqs_unblocker?.toLocaleString()}건, ` +
      `비용 = $${costEntry?.cost?.toFixed(2)}, 대역폭 = ${((costEntry?.bw ?? 0) / 1e9).toFixed(1)}GB\n`
  );
  const officialBillable = costEntry?.reqs_unblocker ?? 0;

  // ── 2. 공식 도메인별 요청 수 (domains/req) → 채널·날짜 집계 ──
  const domReq = (await fetchJson(
    `https://api.brightdata.com/domains/req?from=${from}&to=${to}&zones=${encodeURIComponent(zone)}`,
    token
  )) as Record<string, Record<string, Record<string, number>>>;
  const officialByChannel: Record<Channel, number> = { coupang: 0, naver: 0, danawa: 0 };
  const officialByDate = new Map<string, number>();
  for (const zoneVal of Object.values(domReq)) {
    for (const [dateIso, domains] of Object.entries(zoneVal)) {
      const dateKey = dateIso.slice(0, 10);
      for (const [domain, count] of Object.entries(domains)) {
        const ch = domainToChannel(domain);
        if (!ch) continue;
        officialByChannel[ch] += count;
        officialByDate.set(dateKey, (officialByDate.get(dateKey) ?? 0) + count);
      }
    }
  }
  const officialDomReqTotal =
    officialByChannel.coupang + officialByChannel.naver + officialByChannel.danawa;
  console.log('===== 2. 공식 도메인별 요청 수 (domains/req) =====');
  console.log(
    `  합계 ${officialDomReqTotal.toLocaleString()} | coupang ${officialByChannel.coupang.toLocaleString()}, ` +
      `naver ${officialByChannel.naver.toLocaleString()}, danawa ${officialByChannel.danawa.toLocaleString()}`
  );
  console.log(
    `  → domains/req 합계(${officialDomReqTotal}) vs reqs_unblocker(${officialBillable}): ` +
      `${Math.abs(officialDomReqTotal - officialBillable) <= officialBillable * 0.05 ? '≈ 일치 → domains/req = 과금 기준' : '불일치'}\n`
  );

  // ── 3. 로컬 usage_logs 응답 크기 버킷 (success=200 OK 기준) ──
  const buckets = async (
    ch: Channel,
    kind: 'all' | 'empty' | 'short' | 'full'
  ): Promise<number> => {
    let q = supabase
      .from('brightdata_usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('channel', ch)
      .eq('success', true)
      .gte('created_at', monthStartUtc.toISOString());
    if (kind === 'empty') q = q.or('response_bytes.is.null,response_bytes.eq.0');
    if (kind === 'short') q = q.gte('response_bytes', 1).lt('response_bytes', 5000);
    if (kind === 'full') q = q.gte('response_bytes', 5000);
    const { count } = await q;
    return count ?? 0;
  };

  console.log('===== 3. 로컬 usage_logs 크기 버킷 (success=200) =====');
  console.log('  채널   | success전체 | 빈(0/null) | 짧음(1~5k) | 정상(≥5k) | 본문있음(>0)');
  let totalAll = 0;
  let totalNonEmpty = 0;
  for (const ch of ['coupang', 'naver', 'danawa'] as Channel[]) {
    const [all, empty, short, full] = await Promise.all([
      buckets(ch, 'all'),
      buckets(ch, 'empty'),
      buckets(ch, 'short'),
      buckets(ch, 'full'),
    ]);
    const nonEmpty = all - empty;
    totalAll += all;
    totalNonEmpty += nonEmpty;
    console.log(
      `  ${ch.padEnd(7)}| ${String(all).padStart(10)} | ${String(empty).padStart(9)} | ${String(short).padStart(9)} | ${String(full).padStart(8)} | ${String(nonEmpty).padStart(10)}`
    );
  }
  console.log(
    `  합계   | ${String(totalAll).padStart(10)} |${' '.repeat(34)}| ${String(totalNonEmpty).padStart(10)}\n`
  );

  // ── 4. 결론 ──
  const near = (a: number, b: number): boolean => b > 0 && Math.abs(a - b) <= b * 0.1;
  console.log('===== 4. 결론: 200+0byte 과금 여부 =====');
  console.log(`  공식 과금 요청       = ${officialBillable.toLocaleString()}`);
  console.log(`  로컬 success 전체    = ${totalAll.toLocaleString()} (0byte 포함)`);
  console.log(`  로컬 본문있음(>0)    = ${totalNonEmpty.toLocaleString()} (0byte 제외)`);
  if (near(officialBillable, totalNonEmpty) && !near(officialBillable, totalAll)) {
    console.log(
      `\n  ✅ 판정: 공식 과금 ≈ "본문있음" 이고 success 전체와는 크게 다름 → ` +
        `200+0byte는 과금되지 않음. 0byte 헛과금 없음.`
    );
  } else if (near(officialBillable, totalAll)) {
    console.log(`\n  ⚠ 판정: 공식 과금 ≈ success 전체 → 0byte도 과금됨. 크레딧 청구 검토.`);
  } else {
    console.log(
      `\n  ❓ 판정 보류: 어느 쪽과도 10% 이내로 일치하지 않음(타임존/threshold 경계 영향). ` +
        `본문있음(${totalNonEmpty}) vs 과금(${officialBillable}) 차이 ${(((officialBillable - totalNonEmpty) / (totalNonEmpty || 1)) * 100).toFixed(1)}% 참고.`
    );
  }

  // ── 5. 장애일 스팟체크 (전 채널 0byte였던 날의 공식 과금) ──
  console.log('\n===== 5. 스팟체크: 최근 UTC 날짜별 공식 과금 요청 수 =====');
  const sorted = [...officialByDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [date, count] of sorted.slice(-8)) {
    console.log(`  ${date} (UTC): 과금 ${count.toLocaleString()}건`);
  }
  console.log(
    '  ※ 로컬에서 전 채널 0byte였던 장애일(예: 07-19~21 KST)에 공식 과금이 급감했으면 0byte 무과금의 추가 증거.'
  );
}

main().catch((e) => {
  console.error('[diagnose-billing] 실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
