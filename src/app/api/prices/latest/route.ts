import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { Channel, PriceWithChange, ChannelPrice, FailureWarning } from '@/types/database';

export async function GET() {
  try {
    const supabase = createServiceClient();

    // 활성 상품 조회
    const { data: products, error: prodError } = await supabase
      .from('products')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (prodError) {
      return NextResponse.json({ error: prodError.message }, { status: 500 });
    }

    if (!products || products.length === 0) {
      return NextResponse.json([] as PriceWithChange[]);
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const productIds = products.map((p) => p.id);

    // 오늘과 어제의 가격 로그 조회 (collected_at desc로 같은 채널 첫 항목이 최신)
    const { data: logs, error: logError } = await supabase
      .from('price_logs')
      .select('*')
      .in('product_id', productIds)
      .gte('collected_at', yesterdayStr)
      .lte('collected_at', todayStr + 'T23:59:59.999Z')
      .order('collected_at', { ascending: false });

    if (logError) {
      return NextResponse.json({ error: logError.message }, { status: 500 });
    }

    const channels: Channel[] = ['coupang', 'naver', 'danawa'];

    // logs를 (productId, channel)로 한 번에 인덱싱 — 이후 모든 lookup이 O(1)
    type LogRow = NonNullable<typeof logs>[number];
    const logIndex = new Map<string, LogRow[]>();
    for (const log of logs ?? []) {
      const key = `${log.product_id}:${log.channel}`;
      const arr = logIndex.get(key);
      if (arr) arr.push(log);
      else logIndex.set(key, [log]);
    }

    // 연속 실패 경고 조회: 최근 7일 + 최대 500건으로 제한 (누적 증가 방지)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentErrors } = await supabase
      .from('scrape_errors')
      .select('product_id, channel, created_at')
      .in('product_id', productIds)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(500);

    // 상품×채널별 연속 실패 카운트 계산 (logIndex를 활용해 N+1 제거)
    const failureMap = new Map<string, number>();
    if (recentErrors) {
      const grouped = new Map<string, string[]>();
      for (const err of recentErrors) {
        const key = `${err.product_id}:${err.channel}`;
        const arr = grouped.get(key);
        if (arr) arr.push(err.created_at as string);
        else grouped.set(key, [err.created_at as string]);
      }

      for (const [key, timestamps] of grouped) {
        // logs는 collected_at desc 정렬이라 [0]이 최신 성공 시각
        const latestSuccess = logIndex.get(key)?.[0];
        const latestSuccessTime = latestSuccess
          ? new Date(latestSuccess.collected_at).getTime()
          : 0;
        let consecutiveErrors = 0;
        for (const t of timestamps) {
          if (new Date(t).getTime() > latestSuccessTime) consecutiveErrors++;
        }
        if (consecutiveErrors >= 3) {
          failureMap.set(key, consecutiveErrors);
        }
      }
    }

    const result: PriceWithChange[] = products.map((product) => {
      const prices: ChannelPrice[] = channels.map((channel) => {
        const channelLogs = logIndex.get(`${product.id}:${channel}`) ?? [];

        // 오늘/어제 최신을 한 번의 순회로
        let todayLog: LogRow | undefined;
        let yesterdayLog: LogRow | undefined;
        for (const l of channelLogs) {
          if (!todayLog && l.collected_at.startsWith(todayStr)) todayLog = l;
          else if (!yesterdayLog && l.collected_at.startsWith(yesterdayStr))
            yesterdayLog = l;
          if (todayLog && yesterdayLog) break;
        }

        let change: number | null = null;
        if (todayLog && yesterdayLog) {
          change = todayLog.price - yesterdayLog.price;
        }

        return {
          channel,
          price: todayLog?.price ?? yesterdayLog?.price ?? 0,
          store_name: todayLog?.store_name ?? yesterdayLog?.store_name ?? null,
          change,
        };
      });

      // 연속 3회 이상 실패한 채널 경고 수집
      const warnings: FailureWarning[] = [];
      for (const channel of channels) {
        const key = `${product.id}:${channel}`;
        const count = failureMap.get(key);
        if (count && count >= 3) {
          warnings.push({
            product_id: product.id,
            channel,
            consecutive_failures: count,
          });
        }
      }

      return {
        product_id: product.id,
        product_name: product.name,
        sabangnet_code: product.sabangnet_code ?? null,
        urls: {
          coupang: product.coupang_url,
          naver: product.naver_url,
          danawa: product.danawa_url,
        },
        prices,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/prices/latest]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
