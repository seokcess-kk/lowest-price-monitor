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

    // 오늘과 어제의 가격 로그 조회
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

    // 연속 실패 경고 조회: 최근 scrape_errors에서 상품×채널별 연속 실패 카운트
    const { data: recentErrors } = await supabase
      .from('scrape_errors')
      .select('product_id, channel, created_at')
      .in('product_id', productIds)
      .order('created_at', { ascending: false });

    // 상품×채널별 연속 실패 카운트 계산
    const failureMap = new Map<string, number>();
    if (recentErrors) {
      // 상품×채널별로 그룹핑
      const grouped = new Map<string, string[]>();
      for (const err of recentErrors) {
        const key = `${err.product_id}:${err.channel}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(err.created_at as string);
      }

      for (const [key, timestamps] of grouped) {
        const [productId, channel] = key.split(':');
        // 해당 상품×채널의 가장 최근 성공 수집 시각 조회
        const latestSuccess = (logs || []).find(
          (l) => l.product_id === productId && l.channel === channel
        );
        const latestSuccessTime = latestSuccess
          ? new Date(latestSuccess.collected_at).getTime()
          : 0;
        // 최근 성공 이후의 에러만 카운트
        const consecutiveErrors = timestamps.filter(
          (t) => new Date(t).getTime() > latestSuccessTime
        ).length;
        if (consecutiveErrors >= 3) {
          failureMap.set(key, consecutiveErrors);
        }
      }
    }

    const result: PriceWithChange[] = products.map((product) => {
      const productLogs = (logs || []).filter((l) => l.product_id === product.id);

      const prices: ChannelPrice[] = channels.map((channel) => {
        const channelLogs = productLogs.filter((l) => l.channel === channel);

        // 오늘 최신
        const todayLog = channelLogs.find((l) => l.collected_at.startsWith(todayStr));
        // 어제 최신
        const yesterdayLog = channelLogs.find((l) => l.collected_at.startsWith(yesterdayStr));

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
