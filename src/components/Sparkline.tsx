'use client';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
}

export default function Sparkline({
  values,
  width = 80,
  height = 24,
}: SparklineProps) {
  if (!values || values.length < 2) {
    return (
      <div
        className="text-[10px] text-gray-300"
        style={{ width, height, lineHeight: `${height}px`, textAlign: 'center' }}
      >
        ─
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const stepX = values.length > 1 ? width / (values.length - 1) : width;

  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const first = values[0];
  const last = values[values.length - 1];
  const stroke = last < first ? '#2563eb' : last > first ? '#dc2626' : '#9ca3af';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={`7일 가격 추이 (${values.length}개 지점)`}
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
