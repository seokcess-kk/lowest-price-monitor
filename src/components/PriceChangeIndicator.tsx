'use client';

interface PriceChangeIndicatorProps {
  change: number | null;
  percent?: number | null;
  size?: 'sm' | 'md';
}

export default function PriceChangeIndicator({
  change,
  percent,
  size = 'sm',
}: PriceChangeIndicatorProps) {
  const textSize = size === 'md' ? 'text-sm' : 'text-xs';

  if (change === null || change === undefined) {
    return <span className={`${textSize} text-gray-400`}>-</span>;
  }

  if (change === 0) {
    return <span className={`${textSize} text-gray-500`}>변동없음</span>;
  }

  const isUp = change > 0;
  const color = isUp ? 'text-red-600' : 'text-blue-600';
  const arrow = isUp ? '▲' : '▼';
  const abs = Math.abs(change);
  const pctText =
    percent !== null && percent !== undefined && Number.isFinite(percent)
      ? ` (${Math.abs(percent).toFixed(1)}%)`
      : '';

  return (
    <span className={`${textSize} font-medium ${color}`}>
      {arrow} {abs.toLocaleString('ko-KR')}원{pctText}
    </span>
  );
}
