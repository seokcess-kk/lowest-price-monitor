'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { PriceWithChange, Channel } from '@/types/database';
import { cheapestChannel, productChangePercent, hasFailure } from '@/lib/price-utils';

interface Props {
  data: PriceWithChange[];
  /** 클릭 시 호출 (상품명으로 검색 적용 등). 미지정 시 단순 링크. */
  onProductClick?: (productId: string) => void;
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

const TOP_N = 5;

/**
 * 운영자가 지금 무엇을 봐야 하는지 즉시 보이게 하는 액션 중심 4-패널.
 * KPI 요약과 상품 카드 사이에 들어간다. 모든 데이터는 latest 응답으로 충분.
 */
export default function ActionPanels({ data, onProductClick }: Props) {
  const groups = useMemo(() => {
    const drops: Array<{ item: PriceWithChange; pct: number }> = [];
    const rises: Array<{ item: PriceWithChange; pct: number }> = [];
    const failed: PriceWithChange[] = [];
    const missing: PriceWithChange[] = [];

    for (const item of data) {
      const pct = productChangePercent(item);
      if (pct !== null && pct <= -1) drops.push({ item, pct });
      if (pct !== null && pct >= 1) rises.push({ item, pct });
      if (hasFailure(item)) failed.push(item);

      const urlsAny =
        !!item.urls.coupang || !!item.urls.naver || !!item.urls.danawa;
      const noPrice = item.prices.every((p) => p.price <= 0);
      if (!urlsAny || noPrice) missing.push(item);
    }

    drops.sort((a, b) => a.pct - b.pct); // 가장 큰 하락 먼저 (음수 작은 값)
    rises.sort((a, b) => b.pct - a.pct);
    failed.sort(
      (a, b) => (b.warnings?.length ?? 0) - (a.warnings?.length ?? 0)
    );

    return {
      drops: drops.slice(0, TOP_N),
      rises: rises.slice(0, TOP_N),
      failed: failed.slice(0, TOP_N),
      missing: missing.slice(0, TOP_N),
      counts: {
        drops: drops.length,
        rises: rises.length,
        failed: failed.length,
        missing: missing.length,
      },
    };
  }, [data]);

  const noActionable =
    groups.drops.length === 0 &&
    groups.rises.length === 0 &&
    groups.failed.length === 0 &&
    groups.missing.length === 0;

  if (noActionable) return null;

  return (
    <section
      aria-label="운영 액션 패널"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4 sm:mb-6"
    >
      <Panel
        title="가격 하락 Top"
        emoji="📉"
        tone="down"
        totalCount={groups.counts.drops}
        emptyText="전일 대비 하락 없음"
      >
        {groups.drops.map(({ item, pct }) => (
          <PanelRow
            key={item.product_id}
            item={item}
            onProductClick={onProductClick}
            right={<DeltaBadge pct={pct} />}
          />
        ))}
      </Panel>

      <Panel
        title="가격 급등 Top"
        emoji="📈"
        tone="up"
        totalCount={groups.counts.rises}
        emptyText="전일 대비 상승 없음"
      >
        {groups.rises.map(({ item, pct }) => (
          <PanelRow
            key={item.product_id}
            item={item}
            onProductClick={onProductClick}
            right={<DeltaBadge pct={pct} />}
          />
        ))}
      </Panel>

      <Panel
        title="수집 실패"
        emoji="⚠"
        tone="warn"
        totalCount={groups.counts.failed}
        emptyText="실패 없음"
      >
        {groups.failed.map((item) => (
          <PanelRow
            key={item.product_id}
            item={item}
            onProductClick={onProductClick}
            right={
              <span className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                {item.warnings?.length ?? 0}채널
              </span>
            }
            warnChannels={item.warnings?.map((w) => w.channel)}
          />
        ))}
      </Panel>

      <Panel
        title="URL 누락 / 미수집"
        emoji="❓"
        tone="muted"
        totalCount={groups.counts.missing}
        emptyText="모든 상품 정상 수집"
      >
        {groups.missing.map((item) => {
          const missingChannels: Channel[] = (['coupang', 'naver', 'danawa'] as Channel[]).filter(
            (ch) => !item.urls[ch]
          );
          return (
            <PanelRow
              key={item.product_id}
              item={item}
              onProductClick={onProductClick}
              right={
                <span className="text-[10px] text-gray-500 whitespace-nowrap">
                  {missingChannels.length === 3 ? 'URL 없음' : `${missingChannels.length}/3 누락`}
                </span>
              }
            />
          );
        })}
      </Panel>
    </section>
  );
}

interface PanelProps {
  title: string;
  emoji: string;
  tone: 'down' | 'up' | 'warn' | 'muted';
  totalCount: number;
  emptyText: string;
  children: React.ReactNode;
}

function Panel({ title, emoji, tone, totalCount, emptyText, children }: PanelProps) {
  const toneClass = {
    down: 'border-blue-200 bg-blue-50/40',
    up: 'border-red-200 bg-red-50/40',
    warn: 'border-orange-200 bg-orange-50/40',
    muted: 'border-gray-200 bg-gray-50/60',
  }[tone];
  const titleColor = {
    down: 'text-blue-800',
    up: 'text-red-800',
    warn: 'text-orange-800',
    muted: 'text-gray-700',
  }[tone];
  const isEmpty =
    typeof children === 'object' &&
    children !== null &&
    Array.isArray(children) &&
    (children as React.ReactNode[]).length === 0;
  return (
    <div className={`rounded-lg border ${toneClass} p-3 flex flex-col`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className={`text-xs font-semibold ${titleColor} flex items-center gap-1.5`}>
          <span aria-hidden>{emoji}</span> {title}
        </h3>
        {totalCount > TOP_N && (
          <span className="text-[10px] text-gray-500">총 {totalCount}건</span>
        )}
      </div>
      {isEmpty ? (
        <div className="text-xs text-gray-400 py-2">{emptyText}</div>
      ) : (
        <ul className="space-y-1">{children}</ul>
      )}
    </div>
  );
}

interface PanelRowProps {
  item: PriceWithChange;
  onProductClick?: (productId: string) => void;
  right: React.ReactNode;
  warnChannels?: Channel[];
}

function PanelRow({ item, onProductClick, right, warnChannels }: PanelRowProps) {
  const cheapest = cheapestChannel(item);

  const inner = (
    <div className="flex items-center gap-2 min-w-0">
      <span className="flex-1 min-w-0 truncate text-xs text-gray-800" title={item.product_name}>
        {item.brand_name && (
          <span className="text-[10px] font-semibold text-purple-700 mr-1">
            [{item.brand_name}]
          </span>
        )}
        {item.product_name}
      </span>
      {warnChannels && warnChannels.length > 0 && (
        <span className="flex gap-0.5 shrink-0">
          {warnChannels.map((ch) => (
            <span
              key={ch}
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: CHANNEL_COLORS[ch] }}
              title={CHANNEL_LABELS[ch]}
            />
          ))}
        </span>
      )}
      {cheapest && (
        <span className="text-[10px] text-gray-600 tabular-nums shrink-0">
          {cheapest.price.toLocaleString('ko-KR')}원
        </span>
      )}
      {right}
    </div>
  );

  return (
    <li>
      {onProductClick ? (
        <button
          type="button"
          onClick={() => onProductClick(item.product_id)}
          className="w-full text-left px-2 py-1.5 rounded hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {inner}
        </button>
      ) : (
        <Link
          href={`/products/${item.product_id}`}
          className="block px-2 py-1.5 rounded hover:bg-white/70"
        >
          {inner}
        </Link>
      )}
    </li>
  );
}

function DeltaBadge({ pct }: { pct: number }) {
  const isDown = pct < 0;
  const cls = isDown
    ? 'text-blue-700 bg-blue-50 border-blue-200'
    : 'text-red-700 bg-red-50 border-red-200';
  return (
    <span
      className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded border whitespace-nowrap ${cls}`}
    >
      {isDown ? '▼' : '▲'}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
