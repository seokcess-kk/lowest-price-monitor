'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLatestPrices } from '@/hooks/useLatestPrices';
import PriceTable from '@/components/PriceTable';

interface CollectStatus {
  id?: string;
  status: string;
  result_success?: number;
  result_failed?: number;
  error_message?: string;
  created_at?: string;
  completed_at?: string;
}

export default function Home() {
  const { data, loading, error, refetch } = useLatestPrices();
  const [collecting, setCollecting] = useState(false);
  const [collectStatus, setCollectStatus] = useState<CollectStatus | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/collect');
      const data: CollectStatus = await res.json();
      setCollectStatus(data);

      if (data.status === 'completed' || data.status === 'failed') {
        stopPolling();
        refetch();
      }
    } catch { /* ignore */ }
  }, [refetch, stopPolling]);

  const handleCollect = async () => {
    setCollecting(true);
    setCollectStatus(null);
    try {
      const res = await fetch('/api/collect', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setCollectStatus({ status: 'failed', error_message: body.error });
        return;
      }

      // 폴링 시작 (3초 간격으로 상태 확인)
      setCollectStatus({ status: 'pending' });
      pollRef.current = setInterval(pollStatus, 3000);
    } catch {
      setCollectStatus({ status: 'failed', error_message: '수집 요청 중 오류가 발생했습니다.' });
    } finally {
      setCollecting(false);
    }
  };

  // 컴포넌트 언마운트 시 폴링 정리
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const statusMessage = () => {
    if (!collectStatus) return null;
    switch (collectStatus.status) {
      case 'pending':
        return '수집 대기 중... 로컬 수집기가 요청을 처리합니다.';
      case 'running':
        return '수집 진행 중...';
      case 'completed':
        return `수집 완료: ${collectStatus.result_success}건 성공, ${collectStatus.result_failed}건 실패`;
      case 'failed':
        return `수집 실패: ${collectStatus.error_message || '알 수 없는 오류'}`;
      default:
        return null;
    }
  };

  const isActive = collectStatus?.status === 'pending' || collectStatus?.status === 'running';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">현재 최저가 요약</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCollect}
            disabled={collecting || isActive}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {collecting ? '요청 중...' : isActive ? '수집 중...' : '즉시 수집'}
          </button>
          <button
            onClick={() => { stopPolling(); refetch(); }}
            className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* 수집 상태 표시 */}
      {collectStatus && collectStatus.status !== 'idle' && (
        <div className={`mb-4 p-3 rounded-lg border text-sm ${
          collectStatus.status === 'completed'
            ? 'bg-green-50 border-green-200 text-green-700'
            : collectStatus.status === 'failed'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-blue-50 border-blue-200 text-blue-700'
        }`}>
          <div className="flex items-center gap-2">
            {isActive && (
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            )}
            <span>{statusMessage()}</span>
          </div>
        </div>
      )}

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
