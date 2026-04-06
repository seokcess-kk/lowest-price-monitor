'use client';

interface PriceChangeIndicatorProps {
  change: number | null;
}

export default function PriceChangeIndicator({ change }: PriceChangeIndicatorProps) {
  if (change === null || change === undefined) {
    return <span className="text-xs text-gray-400">-</span>;
  }

  if (change === 0) {
    return <span className="text-xs text-gray-500">변동없음</span>;
  }

  if (change > 0) {
    return (
      <span className="text-xs font-medium text-red-600">
        ▲ {change.toLocaleString('ko-KR')}원
      </span>
    );
  }

  return (
    <span className="text-xs font-medium text-blue-600">
      ▼ {Math.abs(change).toLocaleString('ko-KR')}원
    </span>
  );
}
