import { createServiceClient } from '../src/lib/supabase';

/**
 * 오늘 날짜 (로컬 기준 자정~) 의 수집 실패를 진단한다.
 * - collect_requests: 오늘 실행된 수집 요청 요약
 * - scrape_errors: 채널별 / 에러 메시지별 그룹핑
 * - 샘플 케이스: 채널별 최근 실패 3건
 */
async function main() {
  const supabase = createServiceClient();

  // 로컬 자정 (KST) 기준 시작 — Asia/Seoul 가정
  const now = new Date();
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffsetMs);
  const kstYmd = kstNow.toISOString().slice(0, 10);
  const todayStartUtc = new Date(`${kstYmd}T00:00:00+09:00`).toISOString();
  console.log(`[기준] 오늘 시작(UTC): ${todayStartUtc}  (KST ${kstYmd} 00:00)\n`);

  // 1) collect_requests 요약
  const { data: reqs } = await supabase
    .from('collect_requests')
    .select('id, status, progress_done, progress_total, result_success, result_failed, error_message, created_at, started_at, completed_at')
    .gte('created_at', todayStartUtc)
    .order('created_at', { ascending: false });

  console.log(`=== 오늘 collect_requests (${reqs?.length ?? 0}건) ===`);
  for (const r of reqs ?? []) {
    console.log(
      `  ${r.created_at}  status=${r.status}  done=${r.progress_done}/${r.progress_total}  ok=${r.result_success}  fail=${r.result_failed}`
    );
    if (r.error_message) console.log(`    err: ${r.error_message.slice(0, 300)}`);
  }
  console.log('');

  // 2) scrape_errors — 오늘 분
  const { data: errs } = await supabase
    .from('scrape_errors')
    .select('id, product_id, channel, error_message, created_at, products(name)')
    .gte('created_at', todayStartUtc)
    .order('created_at', { ascending: false });

  console.log(`=== 오늘 scrape_errors 총 ${errs?.length ?? 0}건 ===\n`);

  // 채널별 카운트
  const byChannel = new Map<string, number>();
  for (const e of errs ?? []) {
    byChannel.set(e.channel, (byChannel.get(e.channel) ?? 0) + 1);
  }
  console.log('[채널별 실패 수]');
  for (const [ch, n] of [...byChannel.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ch.padEnd(10)} ${n}`);
  }
  console.log('');

  // 에러 메시지 정규화 후 그룹핑 (앞 120자 키)
  const norm = (s: string) =>
    s
      .replace(/https?:\/\/\S+/g, '<URL>')
      .replace(/[0-9a-f]{8,}/gi, '<HEX>')
      .replace(/\d+/g, '<N>')
      .slice(0, 120);

  type Bucket = { count: number; channels: Map<string, number>; sample: string; sampleProduct: string };
  const buckets = new Map<string, Bucket>();
  for (const e of errs ?? []) {
    const key = `${e.channel}::${norm(e.error_message || '')}`;
    const b = buckets.get(key);
    const productName = (e as { products?: { name?: string } | null }).products?.name ?? e.product_id;
    if (b) {
      b.count++;
      b.channels.set(e.channel, (b.channels.get(e.channel) ?? 0) + 1);
    } else {
      buckets.set(key, {
        count: 1,
        channels: new Map([[e.channel, 1]]),
        sample: e.error_message || '',
        sampleProduct: productName,
      });
    }
  }

  console.log('[에러 메시지 패턴별 Top]');
  const sorted = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [key, b] of sorted.slice(0, 20)) {
    const channel = key.split('::')[0];
    console.log(`\n  [${channel}] x${b.count}`);
    console.log(`  메시지: ${b.sample.slice(0, 300)}`);
    console.log(`  샘플 상품: ${b.sampleProduct}`);
  }

  // 3) brightdata_usage — 오늘 호출 수 / 비용 패턴
  const { data: bd } = await supabase
    .from('brightdata_usage')
    .select('*')
    .gte('created_at', todayStartUtc)
    .order('created_at', { ascending: false })
    .limit(5);
  console.log(`\n=== brightdata_usage 오늘 최근 ${bd?.length ?? 0}건 ===`);
  for (const row of bd ?? []) console.log('  ', row);

  // 3.5) 어제 KST 0~24시 scrape_errors / brightdata_usage 확인 — cron이 어제로 잡힘
  const yStart = new Date(
    new Date(`${kstYmd}T00:00:00+09:00`).getTime() - 24 * 60 * 60 * 1000
  ).toISOString();
  const yEnd = todayStartUtc;
  const { data: yErrs, count: yErrCount } = await supabase
    .from('scrape_errors')
    .select('channel', { count: 'exact', head: false })
    .gte('created_at', yStart)
    .lt('created_at', yEnd);
  const yByCh = new Map<string, number>();
  for (const r of yErrs ?? []) yByCh.set(r.channel, (yByCh.get(r.channel) ?? 0) + 1);
  console.log(`\n[어제 scrape_errors] 총 ${yErrCount ?? 0}건`);
  for (const [ch, n] of yByCh) console.log(`  ${ch.padEnd(10)} ${n}`);

  const { data: yBd, count: yBdCount } = await supabase
    .from('brightdata_usage')
    .select('channel, requests', { count: 'exact', head: false })
    .gte('created_at', yStart)
    .lt('created_at', yEnd);
  console.log(`\n[어제 brightdata_usage] 총 ${yBdCount ?? 0}건`);
  for (const r of yBd ?? []) console.log(`  ${r.channel} reqs=${r.requests}`);

  // 3.6) brightdata_usage_logs — 코드가 실제로 insert하는 테이블 (status_code/response_bytes/success)
  const { data: yLogs, count: yLogsCount } = await supabase
    .from('brightdata_usage_logs')
    .select('channel, status_code, response_bytes, success, duration_ms', { count: 'exact', head: false })
    .gte('created_at', yStart)
    .lt('created_at', yEnd)
    .limit(2000);
  console.log(`\n[어제 brightdata_usage_logs] 총 ${yLogsCount ?? 0}건`);
  if (yLogs && yLogs.length > 0) {
    // 채널×status_code×success 그룹핑
    const grp = new Map<string, { count: number; bytesSum: number; durSum: number }>();
    for (const r of yLogs) {
      const bytesBucket =
        (r.response_bytes ?? 0) === 0
          ? '0B'
          : (r.response_bytes as number) < 5000
            ? '<5KB'
            : '>=5KB';
      const key = `${r.channel}|status=${r.status_code ?? 'null'}|ok=${r.success}|${bytesBucket}`;
      const cur = grp.get(key) ?? { count: 0, bytesSum: 0, durSum: 0 };
      cur.count++;
      cur.bytesSum += r.response_bytes ?? 0;
      cur.durSum += r.duration_ms ?? 0;
      grp.set(key, cur);
    }
    const sorted = [...grp.entries()].sort((a, b) => b[1].count - a[1].count);
    for (const [key, v] of sorted) {
      const avgBytes = Math.round(v.bytesSum / v.count);
      const avgDur = Math.round(v.durSum / v.count);
      console.log(`  ${key.padEnd(50)} x${v.count}  avgBytes=${avgBytes}  avgDur=${avgDur}ms`);
    }
  }

  // 4) 활성 상품 수
  const { count: activeCount } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);
  console.log(`\n=== 활성 상품 ${activeCount ?? 0}개 ===`);

  // 5) 오늘/어제 price_logs 채널별 카운트
  const yesterdayStartUtc = new Date(
    new Date(`${kstYmd}T00:00:00+09:00`).getTime() - 24 * 60 * 60 * 1000
  ).toISOString();

  const countLogs = async (since: string, until: string | null, label: string) => {
    let q = supabase
      .from('price_logs')
      .select('channel', { count: 'exact', head: false })
      .gte('collected_at', since);
    if (until) q = q.lt('collected_at', until);
    const { data, count } = await q;
    const byCh = new Map<string, number>();
    for (const r of data ?? []) byCh.set(r.channel, (byCh.get(r.channel) ?? 0) + 1);
    console.log(`\n[${label}] 총 ${count ?? 0}건`);
    for (const [ch, n] of byCh) console.log(`  ${ch.padEnd(10)} ${n}`);
  };
  await countLogs(todayStartUtc, null, '오늘 price_logs');
  await countLogs(yesterdayStartUtc, todayStartUtc, '어제 price_logs');

  // 6) 최근 7일 / 30일 동안 한 번도 가격이 들어오지 않은 상품 수
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent7 } = await supabase
    .from('price_logs')
    .select('product_id')
    .gte('collected_at', since7);
  const { data: recent30 } = await supabase
    .from('price_logs')
    .select('product_id')
    .gte('collected_at', since30);
  const seen7 = new Set((recent7 ?? []).map((r) => r.product_id as string));
  const seen30 = new Set((recent30 ?? []).map((r) => r.product_id as string));
  console.log(
    `\n[가격이 있던 상품 수] 7일: ${seen7.size} / 30일: ${seen30.size} / 활성: ${activeCount}`
  );

  // 7) 가장 최근 price_logs 마지막 시각 — "마지막 수집 시각"
  const { data: lastLog } = await supabase
    .from('price_logs')
    .select('collected_at')
    .order('collected_at', { ascending: false })
    .limit(1);
  console.log(`\n[가장 최근 price_logs] ${lastLog?.[0]?.collected_at ?? 'none'}`);

  // 8) 최근 10건 collect_requests — 패턴 파악용
  const { data: reqs10 } = await supabase
    .from('collect_requests')
    .select('id, status, progress_done, progress_total, result_success, result_failed, error_message, created_at, completed_at, product_id')
    .order('created_at', { ascending: false })
    .limit(15);
  console.log(`\n=== 최근 collect_requests 15건 (전역+개별) ===`);
  for (const r of reqs10 ?? []) {
    const dur =
      r.completed_at && r.created_at
        ? `${Math.round((new Date(r.completed_at).getTime() - new Date(r.created_at).getTime()) / 60000)}분`
        : '미완료';
    console.log(
      `  ${r.created_at.slice(0, 19)}  ${r.product_id ? '단일' : '전역'} status=${r.status.padEnd(10)} ` +
        `done=${r.progress_done}/${r.progress_total}  ok=${r.result_success ?? '-'}  fail=${r.result_failed ?? '-'}  ${dur}`
    );
    if (r.error_message)
      console.log(`    err: ${r.error_message.slice(0, 200)}`);
  }

  // 9) 채널별 어제 (KST) price_logs 분포 — 어제도 비슷한 양상이었는지
  const yesterdayKstYmd = new Date(
    new Date(`${kstYmd}T00:00:00+09:00`).getTime() - 24 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);
  console.log(`\n[참고] 어제 KST 날짜: ${yesterdayKstYmd}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
