import { KpiCardSkeleton, ChartSkeleton, Skeleton } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-7 w-2/3" />
        <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
          <Skeleton className="h-3 w-20 mb-2" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-4 sm:mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <ChartSkeleton height={400} />
      </div>
    </div>
  );
}
