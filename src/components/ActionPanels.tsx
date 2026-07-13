'use client';

import Link from 'next/link';
import type { PanelGroups, PriceWithChange, Channel } from '@/types/database';
import { cheapestChannel } from '@/lib/price-utils';
import type { ChangeFilter } from '@/components/FilterChips';

interface Props {
  /** 서버(api/dashboard)가 전체 필터셋 기준으로 집계한 Top N + 카운트 */
  panel: PanelGroups;
  /** 클릭 시 호출 (상품명으로 검색 적용 등). 미지정 시 단순 링크. */
  onProductClick?: (item: PriceWithChange) => void;
  /**
   * 패널 헤더 '전체 보기' 클릭 시 호출.
   * 메인 목록을 같은 조건으로 필터링하기 위해 HomeClient에서 setFilter로 연결.
   */
  onSelectFilter?: (filter: ChangeFilter) => void;
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
 * KPI 요약과 상품 카드 사이에 들어간다.
 * 그룹핑은 서버(computePanelGroups)가 전체 필터셋 기준으로 계산해 내려준다 —
 * 클라이언트는 페이지 슬라이스만 들고 있어 여기서 집계하면 값이 틀어진다.
 */
export default function ActionPanels({ panel, onProductClick, onSelectFilter }: Props) {
  const groups = panel;

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
        filterKey="drops"
        onSelectFilter={onSelectFilter}
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
        filterKey="rises"
        onSelectFilter={onSelectFilter}
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
        filterKey="failed"
        onSelectFilter={onSelectFilter}
      >
        {groups.failed.map((item) => (
          <PanelRow
            key={item.product_id}
            item={item}
            onProductClick={onProductClick}
            right={
              <span
                className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 whitespace-nowrap"
                title={(item.warnings ?? [])
                  .map(
                    (w) =>
                      `${CHANNEL_LABELS[w.channel]}: ${w.last_failure_message || '수집 실패'}`
                  )
                  .join('\n')}
              >
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
        filterKey="missing"
        onSelectFilter={onSelectFilter}
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
  filterKey?: ChangeFilter;
  onSelectFilter?: (filter: ChangeFilter) => void;
}

function Panel({
  title,
  emoji,
  tone,
  totalCount,
  emptyText,
  children,
  filterKey,
  onSelectFilter,
}: PanelProps) {
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
  const linkColor = {
    down: 'text-blue-700 hover:text-blue-900',
    up: 'text-red-700 hover:text-red-900',
    warn: 'text-orange-700 hover:text-orange-900',
    muted: 'text-gray-700 hover:text-gray-900',
  }[tone];
  const isEmpty =
    typeof children === 'object' &&
    children !== null &&
    Array.isArray(children) &&
    (children as React.ReactNode[]).length === 0;
  const canFilter = !isEmpty && totalCount > 0 && filterKey && onSelectFilter;
  return (
    <div className={`rounded-lg border ${toneClass} p-3 flex flex-col`}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className={`text-xs font-semibold ${titleColor} flex items-center gap-1.5 min-w-0`}>
          <span aria-hidden>{emoji}</span>
          <span className="truncate">{title}</span>
          {totalCount > TOP_N && (
            <span className="text-[10px] text-gray-500 font-normal">
              총 {totalCount}건
            </span>
          )}
        </h3>
        {canFilter && (
          <button
            type="button"
            onClick={() => onSelectFilter!(filterKey!)}
            className={`shrink-0 text-[11px] font-medium ${linkColor} hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded`}
            aria-label={`${title} ${totalCount}건 전체 필터로 보기`}
          >
            전체 보기 →
          </button>
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
  onProductClick?: (item: PriceWithChange) => void;
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
          onClick={() => onProductClick(item)}
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
