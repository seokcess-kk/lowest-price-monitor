/**
 * 재사용 가능한 회색 placeholder 블록.
 * className으로 너비·높이·라운드 등을 자유 지정.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-gray-200 rounded ${className}`}
      aria-hidden="true"
    />
  );
}

/** KPI 카드 1개 크기 스켈레톤 */
export function KpiCardSkeleton() {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <Skeleton className="h-3 w-20 mb-2" />
      <Skeleton className="h-6 w-24" />
    </div>
  );
}

/** 상품 카드 1개 크기 스켈레톤 (메인 카드 뷰) */
export function ProductCardSkeleton() {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <Skeleton className="h-4 w-3/4" />
      <div className="flex items-end justify-between gap-2">
        <div className="space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-7 w-16" />
      </div>
      <div className="grid grid-cols-3 gap-1 pt-2 border-t border-gray-100">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    </div>
  );
}

/** 상품 관리 모바일 행 스켈레톤 */
export function ProductRowSkeleton() {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start gap-2">
        <Skeleton className="h-4 w-4 mt-1" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </div>
  );
}

/** 차트 영역 스켈레톤 */
export function ChartSkeleton({ height = 400 }: { height?: number }) {
  return (
    <div
      className="w-full bg-gray-100 rounded animate-pulse flex items-end justify-between p-4 gap-1"
      style={{ height }}
      aria-hidden="true"
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 bg-gray-200 rounded-t"
          style={{ height: `${30 + ((i * 13) % 60)}%` }}
        />
      ))}
    </div>
  );
}
