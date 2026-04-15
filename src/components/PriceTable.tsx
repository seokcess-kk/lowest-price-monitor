'use client';

import { useState, useMemo } from 'react';
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

interface PriceTableProps {
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

type SortKey = 'name' | 'cheapest' | 'changePct';
type SortDir = 'asc' | 'desc';

export default function PriceTable({
  data,
  sparklineMap,
  collectingIds,
  globalCollecting,
  onCollectProduct,
}: PriceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    const arr = [...data];
    arr.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'string' && typeof vb === 'string') {
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const na = va as number;
      const nb = vb as number;
      return sortDir === 'asc' ? na - nb : nb - na;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (data.length === 0) {
    return (
      <div className="p-12 text-center text-gray-400">표시할 상품이 없습니다.</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b">
            <th className="w-8 px-2 py-3"></th>
            <SortableHeader
              label="상품명"
              active={sortKey === 'name'}
              dir={sortDir}
              onClick={() => handleSort('name')}
              align="left"
            />
            <SortableHeader
              label="최저가"
              active={sortKey === 'cheapest'}
              dir={sortDir}
              onClick={() => handleSort('cheapest')}
              align="right"
            />
            <SortableHeader
              label="변동률"
              active={sortKey === 'changePct'}
              dir={sortDir}
              onClick={() => handleSort('changePct')}
              align="right"
            />
            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
              7일 추이
            </th>
            <th className="px-2 py-3 text-center text-sm font-semibold text-gray-700 w-12">
              수집
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => {
            const cheapest = cheapestChannel(item);
            const pct = productChangePercent(item);
            const isExpanded = expanded.has(item.product_id);
            const sparkline = sparklineMap?.[item.product_id];

            return (
              <RowGroup
                key={item.product_id}
                item={item}
                cheapest={cheapest}
                pct={pct}
                isExpanded={isExpanded}
                onToggle={() => toggleRow(item.product_id)}
                sparkline={sparkline}
                collecting={collectingIds?.has(item.product_id) ?? false}
                globalCollecting={globalCollecting ?? false}
                onCollectProduct={onCollectProduct}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function sortValue(
  item: PriceWithChange,
  key: SortKey
): string | number | null {
  if (key === 'name') return item.product_name;
  if (key === 'cheapest') {
    const c = cheapestChannel(item);
    return c ? c.price : null;
  }
  if (key === 'changePct') return productChangePercent(item);
  return null;
}

interface SortableHeaderProps {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: 'left' | 'right' | 'center';
}

function SortableHeader({ label, active, dir, onClick, align = 'left' }: SortableHeaderProps) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      className={`px-4 py-3 ${alignClass} text-sm font-semibold text-gray-700 cursor-pointer select-none hover:bg-gray-100`}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-xs ${active ? 'text-blue-600' : 'text-gray-300'}`}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  );
}

interface RowGroupProps {
  item: PriceWithChange;
  cheapest: ReturnType<typeof cheapestChannel>;
  pct: number | null;
  isExpanded: boolean;
  onToggle: () => void;
  sparkline?: number[];
  collecting: boolean;
  globalCollecting: boolean;
  onCollectProduct?: (id: string) => void;
}

function RowGroup({
  item,
  cheapest,
  pct,
  isExpanded,
  onToggle,
  sparkline,
  collecting,
  globalCollecting,
  onCollectProduct,
}: RowGroupProps) {
  const cheapestPrice = cheapest?.price ?? null;
  const cheapestChannelKey = cheapest?.channel ?? null;
  const cheapestStoreName =
    cheapest && cheapest.channel !== 'coupang' ? cheapest.store_name : null;
  const hasFailures = !!item.warnings && item.warnings.length > 0;

  return (
    <>
      <tr
        className="border-b hover:bg-blue-50/30 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-2 py-3 text-center text-gray-400 text-xs">
          {isExpanded ? '▼' : '▶'}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <Link
              href={`/products/${item.product_id}`}
              className="text-blue-600 hover:underline font-medium"
              onClick={(e) => e.stopPropagation()}
            >
              {item.product_name}
            </Link>
            {hasFailures && (
              <span
                className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5"
                title={`${item.warnings!.length}개 채널 수집 실패`}
              >
                ⚠ {item.warnings!.length}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          {cheapestPrice !== null ? (
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center justify-end gap-2">
                {cheapestChannelKey && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white"
                    style={{ backgroundColor: CHANNEL_COLORS[cheapestChannelKey] }}
                    title={`${CHANNEL_LABELS[cheapestChannelKey]} 최저`}
                  >
                    👑 {CHANNEL_LABELS[cheapestChannelKey]}
                  </span>
                )}
                <span className="font-semibold text-gray-900 tabular-nums">
                  {cheapestPrice.toLocaleString('ko-KR')}원
                </span>
              </div>
              {cheapestStoreName && (
                <span
                  className="text-[10px] text-gray-500 truncate max-w-[140px]"
                  title={cheapestStoreName}
                >
                  @ {cheapestStoreName}
                </span>
              )}
            </div>
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          {cheapest && cheapest.change !== null ? (
            <PriceChangeIndicator change={cheapest.change} percent={pct} />
          ) : (
            <span className="text-xs text-gray-400">-</span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex justify-center">
            <Sparkline values={sparkline ?? []} width={80} height={24} />
          </div>
        </td>
        <td className="px-2 py-3 text-center">
          {onCollectProduct && (
            <CollectProductButton
              productId={item.product_id}
              collecting={collecting}
              disabled={globalCollecting}
              onClick={onCollectProduct}
            />
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-gray-50/50 border-b">
          <td></td>
          <td colSpan={5} className="px-4 py-3">
            <ChannelDetailGrid item={item} cheapestChannel={cheapestChannelKey} />
          </td>
        </tr>
      )}
    </>
  );
}

function ChannelDetailGrid({
  item,
  cheapestChannel,
}: {
  item: PriceWithChange;
  cheapestChannel: Channel | null;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {CHANNELS.map((ch) => {
        const channelPrice = item.prices.find((p) => p.channel === ch);
        const warning = item.warnings?.find((w) => w.channel === ch);
        const url = item.urls?.[ch];
        const isCheapest = cheapestChannel === ch;
        const pct = channelPrice ? changePercent(channelPrice) : null;

        const inner = (
          <>
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-xs font-semibold"
                style={{ color: CHANNEL_COLORS[ch] }}
              >
                {CHANNEL_LABELS[ch]}
                {isCheapest && <span className="ml-1">👑</span>}
              </span>
              {url && <span className="text-xs text-gray-400">↗</span>}
            </div>
            {warning && (
              <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 mb-2">
                연속 {warning.consecutive_failures}회 수집 실패
              </div>
            )}
            {channelPrice && channelPrice.price > 0 ? (
              <>
                <div className="text-base font-bold text-gray-900 tabular-nums">
                  {channelPrice.price.toLocaleString('ko-KR')}원
                </div>
                <div className="mt-1">
                  <PriceChangeIndicator
                    change={channelPrice.change}
                    percent={pct}
                  />
                </div>
                {channelPrice.store_name && (
                  <div className="mt-1 text-xs text-gray-500">
                    {channelPrice.store_name}
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-gray-400">데이터 없음</div>
            )}
          </>
        );

        const baseClass = `block rounded-md border p-3 transition-colors ${
          isCheapest
            ? 'border-yellow-400 bg-yellow-50/40'
            : 'border-gray-200 bg-white'
        }`;

        return url ? (
          <a
            key={ch}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${baseClass} cursor-pointer hover:border-blue-400 hover:bg-blue-50/40`}
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
  );
}
