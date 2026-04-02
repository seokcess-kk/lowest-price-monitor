'use client';

import { useState } from 'react';
import { useLatestPrices } from '@/hooks/useLatestPrices';
import PriceTable from '@/components/PriceTable';

export default function Home() {
  const { data, loading, error, refetch } = useLatestPrices();
  const [collecting, setCollecting] = useState(false);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);

  const handleCollect = async () => {
    setCollecting(true);
    setCollectMsg(null);
    try {
      const res = await fetch('/api/collect', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setCollectMsg(body.error || '수집 트리거 실패');
      } else {
        setCollectMsg(body.message || '수집이 트리거되었습니다.');
      }
    } catch {
      setCollectMsg('수집 트리거 중 오류가 발생했습니다.');
    } finally {
      setCollecting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">현재 최저가 요약</h1>
        <div className="flex items-center gap-3">
          {collectMsg && (
            <span className="text-sm text-gray-600">{collectMsg}</span>
          )}
          <button
            onClick={handleCollect}
            disabled={collecting}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {collecting ? '트리거 중...' : '즉시 수집'}
          </button>
          <button
            onClick={refetch}
            className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
          >
            새로고침
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-12 text-gray-500">로딩 중...</div>
      )}

      {error && (
        <div className="text-center py-12 text-red-500">오류: {error}</div>
      )}

      {!loading && !error && data.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          등록된 상품이 없습니다. 상품 관리에서 상품을 추가해주세요.
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border">
          <PriceTable data={data} />
        </div>
      )}
    </div>
  );
}
