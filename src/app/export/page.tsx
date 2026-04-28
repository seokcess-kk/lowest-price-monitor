import { Suspense } from 'react';
import ExportClient from './ExportClient';

// useSearchParams를 사용하는 client 컴포넌트는 Suspense로 감싸야 한다.
// dynamic 강제는 정적 prerender를 건너뛰고 매 요청마다 렌더.
export const dynamic = 'force-dynamic';

export default function ExportPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-gray-500">로딩 중...</div>}>
      <ExportClient />
    </Suspense>
  );
}
