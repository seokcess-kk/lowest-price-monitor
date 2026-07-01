import { Suspense } from 'react';
import ExportClient from './ExportClient';
import { ManageSkeleton, Skeleton } from '@/components/Skeleton';

// useSearchParams는 Suspense 경계만 있으면 됨. force-dynamic을 두면 셸이
// 정적 프리렌더되지 않아 <Link> 프리페치가 셸 전체를 캐시하지 못하고
// 전환마다 서버 왕복이 생긴다. 정적 셸 + 클라이언트 데이터 fetch로 둔다.
export default function ExportPage() {
  return (
    <Suspense
      fallback={
        <div>
          <Skeleton className="h-7 w-40 mb-6" />
          <div className="bg-white rounded-lg border p-4 mb-4 space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
          <ManageSkeleton />
        </div>
      }
    >
      <ExportClient />
    </Suspense>
  );
}
