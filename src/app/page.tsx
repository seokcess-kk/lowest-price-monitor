'use client';

import { useState, useEffect, useRef } from 'react';
import { useLatestPrices } from '@/hooks/useLatestPrices';
import PriceTable from '@/components/PriceTable';

export default function Home() {
  const { data, loading, error, refetch } = useLatestPrices();
  const [collecting, setCollecting] = useState(false);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const productCount = data.length || 1;
  const estimatedSeconds = 60 + productCount * 30;

  const handleCollect = async () => {
    setCollecting(true);
    setCollectMsg(null);
    setElapsed(0);
    try {
      const res = await fetch('/api/collect', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setCollectMsg(body.error || '수집 트리거 실패');
      } else {
        // 트리거 성공 후 타이머 시작
        setIsRunning(true);
        timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      }
    } catch {
      setCollectMsg('수집 트리거 중 오류가 발생했습니다.');
    } finally {
      setCollecting(false);
    }
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRunning(false);
  };

  // 예상 시간 초과 시 자동 종료
  useEffect(() => {
    if (isRunning && elapsed >= estimatedSeconds) {
      stopTimer();
      setCollectMsg('수집이 완료되었을 수 있습니다. 새로고침을 눌러 확인하세요.');
    }
  }, [elapsed, estimatedSeconds, isRunning]);

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}분 ${s}초` : `${s}초`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">현재 최저가 요약</h1>
        <div className="flex items-center gap-3">
          {collectMsg && !isRunning && (
            <span className="text-sm text-gray-600">{collectMsg}</span>
          )}
          <button
            onClick={handleCollect}
            disabled={collecting || isRunning}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {collecting ? '트리거 중...' : isRunning ? '수집 중...' : '즉시 수집'}
          </button>
          <button
            onClick={() => { stopTimer(); refetch(); }}
            className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
          >
            새로고침
          </button>
        </div>
      </div>

      {isRunning && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <span className="text-blue-700">
              수집 진행 중... {formatTime(elapsed)} 경과 (예상 약 {formatTime(estimatedSeconds)})
            </span>
            <span className="text-blue-500">
              {Math.min(Math.round((elapsed / estimatedSeconds) * 100), 99)}%
            </span>
          </div>
          <div className="mt-2 w-full bg-blue-100 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-1000"
              style={{ width: `${Math.min((elapsed / estimatedSeconds) * 100, 99)}%` }}
            />
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
