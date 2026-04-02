'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { usePriceHistory } from '@/hooks/usePriceHistory';
import PriceChart from '@/components/PriceChart';

type Period = '7d' | '30d' | '90d' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  '7d': '7일',
  '30d': '30일',
  '90d': '90일',
  all: '전체',
};

function getStartDate(period: Period): string | undefined {
  if (period === 'all') return undefined;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

export default function ProductDetailPage() {
  const params = useParams();
  const productId = params.id as string;
  const [period, setPeriod] = useState<Period>('30d');

  const startDate = useMemo(() => getStartDate(period), [period]);

  const { data, loading, error } = usePriceHistory(productId, {
    startDate,
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">가격 추이</h1>

      {/* 기간 선택 */}
      <div className="flex gap-2 mb-6">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              period === p
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {loading && <div className="text-center py-12 text-gray-500">로딩 중...</div>}
      {error && <div className="text-center py-12 text-red-500">오류: {error}</div>}

      {!loading && !error && (
        <>
          {/* 차트 */}
          <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
            <PriceChart data={data} />
          </div>

          {/* 수집 로그 테이블 */}
          <div className="bg-white rounded-lg shadow-sm border">
            <h2 className="text-lg font-semibold text-gray-800 px-4 pt-4 pb-2">최근 수집 로그</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">수집일시</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">채널</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">가격</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">스토어</th>
                  </tr>
                </thead>
                <tbody>
                  {data.slice(0, 50).map((log) => (
                    <tr key={log.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm text-gray-600">
                        {new Date(log.collected_at).toLocaleString('ko-KR')}
                      </td>
                      <td className="px-4 py-2 text-sm">{log.channel}</td>
                      <td className="px-4 py-2 text-sm text-right font-medium">
                        {log.price.toLocaleString('ko-KR')}원
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500">
                        {log.store_name || '-'}
                      </td>
                    </tr>
                  ))}
                  {data.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                        수집 데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
