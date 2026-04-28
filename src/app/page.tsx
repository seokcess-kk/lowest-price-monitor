import { Suspense } from 'react';
import Home from './HomeClient';

// useSearchParams 사용 페이지는 Suspense + dynamic 렌더링 필요.
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-gray-500">로딩 중...</div>}>
      <Home />
    </Suspense>
  );
}
