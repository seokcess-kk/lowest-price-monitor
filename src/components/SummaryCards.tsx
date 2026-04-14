'use client';

import type { PriceWithChange } from '@/types/database';
import { computeSummary } from '@/lib/price-utils';

interface SummaryCardsProps {
  data: PriceWithChange[];
}

export default function SummaryCards({ data }: SummaryCardsProps) {
  const stats = computeSummary(data);
  const avg = stats.averageChangePct;
  const avgColor =
    avg === null
      ? 'text-gray-500'
      : avg < 0
        ? 'text-blue-600'
        : avg > 0
          ? 'text-red-600'
          : 'text-gray-700';
  const avgLabel =
    avg === null
      ? '-'
      : `${avg > 0 ? '▲ ' : avg < 0 ? '▼ ' : ''}${Math.abs(avg).toFixed(1)}%`;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
      <Card label="총 상품" value={`${stats.totalProducts}개`} tone="neutral" />
      <Card
        label="가격 변동 상품"
        value={`${stats.changedProducts}개`}
        sub={
          stats.totalProducts > 0
            ? `${Math.round((stats.changedProducts / stats.totalProducts) * 100)}%`
            : undefined
        }
        tone={stats.changedProducts > 0 ? 'highlight' : 'neutral'}
      />
      <Card
        label="평균 변동률 (어제 대비)"
        value={avgLabel}
        valueColor={avgColor}
        tone="neutral"
      />
      <Card
        label="수집 실패 채널"
        value={`${stats.failedChannels}건`}
        tone={stats.failedChannels > 0 ? 'danger' : 'neutral'}
      />
    </div>
  );
}

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  tone: 'neutral' | 'highlight' | 'danger';
  valueColor?: string;
}

function Card({ label, value, sub, tone, valueColor }: CardProps) {
  const toneClass = {
    neutral: 'bg-white border-gray-200',
    highlight: 'bg-blue-50 border-blue-200',
    danger: 'bg-red-50 border-red-200',
  }[tone];
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="text-xs font-medium text-gray-600">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className={`text-2xl font-bold ${valueColor ?? 'text-gray-900'}`}>
          {value}
        </div>
        {sub && <div className="text-xs text-gray-500">{sub}</div>}
      </div>
    </div>
  );
}
