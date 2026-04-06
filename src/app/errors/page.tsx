'use client';

import { useState, useEffect } from 'react';

interface ScrapeError {
  id: string;
  product_id: string;
  product_name: string;
  channel: string;
  error_message: string;
  created_at: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  danawa: '다나와',
};

const CHANNEL_DOTS: Record<string, string> = {
  coupang: '#E44232',
  naver: '#03C75A',
  danawa: '#0068B7',
};

const CHANNEL_COLORS: Record<string, string> = {
  coupang: 'bg-red-50 text-red-700',
  naver: 'bg-green-50 text-green-700',
  danawa: 'bg-blue-50 text-blue-700',
};

export default function ErrorsPage() {
  const [errors, setErrors] = useState<ScrapeError[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/errors?limit=100');
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || '에러 로그를 불러오지 못했습니다.');
        }
        const data: ScrapeError[] = await res.json();
        setErrors(data);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : '알 수 없는 오류');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">수집 에러 로그</h1>

      {loading && (
        <div className="text-center py-12 text-gray-500">로딩 중...</div>
      )}

      {fetchError && (
        <div className="text-center py-12 text-red-500">오류: {fetchError}</div>
      )}

      {!loading && !fetchError && errors.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          수집 에러가 없습니다.
        </div>
      )}

      {!loading && !fetchError && errors.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">시각</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">상품명</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">채널</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">에러 내용</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((err) => (
                <tr key={err.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {formatDate(err.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {err.product_name}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${CHANNEL_COLORS[err.channel] || 'bg-gray-100 text-gray-700'}`}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CHANNEL_DOTS[err.channel] || '#666' }} />
                      {CHANNEL_LABELS[err.channel] || err.channel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-red-600 font-mono">
                    {err.error_message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
