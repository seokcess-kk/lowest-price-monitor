'use client';

import Link from 'next/link';
import type { PriceWithChange, Channel } from '@/types/database';
import PriceChangeIndicator from './PriceChangeIndicator';
import Sparkline from './Sparkline';
import CollectProductButton from './CollectProductButton';
import {
  cheapestChannel,
  changePercent,
  productChangePercent,
} from '@/lib/price-utils';

interface PriceCardListProps {
  data: PriceWithChange[];
  sparklineMap?: Record<string, number[]>;
  collectingIds?: Set<string>;
  globalCollecting?: boolean;
  onCollectProduct?: (id: string) => void;
}

const CHANNEL_LABELS: Record<Channel, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  danawa: '다나와',
};

const CHANNEL_COLORS: Record<Channel, string> = {
  coupang: '#E44232',
  naver: '#03C75A',
  danawa: '#0068B7',
};

const CHANNELS: Channel[] = ['coupang', 'naver', 'danawa'];

export default function PriceCardList({
  data,
  sparklineMap,
  collectingIds,
  globalCollecting,
  onCollectProduct,
}: PriceCardListProps) {
  if (data.length === 0) {
    return (
      <div className="p-12 text-center text-gray-400">표시할 상품이 없습니다.</div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((item) => {
        const cheapest = cheapestChannel(item);
        const pct = productChangePercent(item);
        const sparkline = sparklineMap?.[item.product_id];
        const failureCount = item.warnings?.length ?? 0;

        return (
          <div
            key={item.product_id}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition"
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex-1 min-w-0">
                {item.brand_name && (
                  <div className="text-[10px] font-semibold text-purple-700 mb-0.5">
                    {item.brand_name}
                  </div>
                )}
                <Link
                  href={`/products/${item.product_id}`}
                  className="text-blue-600 hover:underline font-medium text-sm leading-tight"
                >
                  {item.product_name}
                </Link>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {failureCount > 0 && (
                  <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                    ⚠ {failureCount}
                  </span>
                )}
                {onCollectProduct && (
                  <CollectProductButton
                    productId={item.product_id}
                    collecting={collectingIds?.has(item.product_id) ?? false}
                    disabled={globalCollecting ?? false}
                    onClick={onCollectProduct}
                    size="sm"
                  />
                )}
              </div>
            </div>

            <div className="flex items-end justify-between mb-3">
              <div>
                {cheapest ? (
                  <>
                    <div className="text-xl font-bold text-gray-900 tabular-nums">
                      {cheapest.price.toLocaleString('ko-KR')}원
                    </div>
                    <div className="mt-0.5">
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white mr-1"
                        style={{ backgroundColor: CHANNEL_COLORS[cheapest.channel] }}
                      >
                        👑 {CHANNEL_LABELS[cheapest.channel]}
                      </span>
                      <PriceChangeIndicator change={cheapest.change} percent={pct} />
                    </div>
                  </>
                ) : (
                  <div className="text-gray-400 text-sm">데이터 없음</div>
                )}
              </div>
              <Sparkline values={sparkline ?? []} width={70} height={28} />
            </div>

            <div className="border-t border-gray-100 pt-2 grid grid-cols-3 gap-1 text-xs">
              {CHANNELS.map((ch) => {
                const cp = item.prices.find((p) => p.channel === ch);
                const url = item.urls?.[ch];
                const isCheapest = cheapest?.channel === ch;
                const channelPct = cp ? changePercent(cp) : null;

                const inner = (
                  <>
                    <div
                      className="font-semibold text-[11px]"
                      style={{ color: CHANNEL_COLORS[ch] }}
                    >
                      {CHANNEL_LABELS[ch]}
                    </div>
                    {cp && cp.price > 0 ? (
                      <>
                        <div className="text-gray-900 tabular-nums text-xs">
                          {cp.price.toLocaleString('ko-KR')}
                        </div>
                        {ch !== 'coupang' && cp.store_name && (
                          <div
                            className="text-[10px] text-gray-500 truncate"
                            title={cp.store_name}
                          >
                            {cp.store_name}
                          </div>
                        )}
                        {channelPct !== null && Math.abs(channelPct) > 0.05 && (
                          <div
                            className={`text-[10px] ${
                              channelPct < 0 ? 'text-blue-600' : 'text-red-600'
                            }`}
                          >
                            {channelPct < 0 ? '▼' : '▲'}
                            {Math.abs(channelPct).toFixed(1)}%
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-gray-400">-</div>
                    )}
                  </>
                );

                const baseClass = `block p-2 min-h-[60px] rounded text-center transition-colors ${
                  isCheapest ? 'bg-yellow-50' : ''
                }`;

                return url ? (
                  <a
                    key={ch}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${baseClass} cursor-pointer hover:bg-blue-50 hover:ring-1 hover:ring-blue-200`}
                    title={`${CHANNEL_LABELS[ch]} 페이지로 이동`}
                  >
                    {inner}
                  </a>
                ) : (
                  <div key={ch} className={baseClass}>
                    {inner}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
