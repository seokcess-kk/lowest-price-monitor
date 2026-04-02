'use client';

interface PriceChangeIndicatorProps {
  change: number | null;
}

export default function PriceChangeIndicator({ change }: PriceChangeIndicatorProps) {
  if (change === null || change === undefined) {
    return <span className="text-gray-400">-</span>;
  }

  if (change === 0) {
    return <span className="text-gray-500">-</span>;
  }

  if (change > 0) {
    return (
      <span className="text-red-500 text-sm">
        ▲ {change.toLocaleString('ko-KR')}
      </span>
    );
  }

  return (
    <span className="text-blue-500 text-sm">
      ▼ {Math.abs(change).toLocaleString('ko-KR')}
    </span>
  );
}
