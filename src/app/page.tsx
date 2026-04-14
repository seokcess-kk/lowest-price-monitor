'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLatestPrices } from '@/hooks/useLatestPrices';
import { useSparklines } from '@/hooks/useSparklines';
import PriceTable from '@/components/PriceTable';
import PriceCardList from '@/components/PriceCardList';
import SummaryCards from '@/components/SummaryCards';
import SearchInput from '@/components/SearchInput';
import FilterChips, { type ChangeFilter } from '@/components/FilterChips';
import ViewToggle, { type ViewMode } from '@/components/ViewToggle';
import { hasAnyChange, hasBigDrop, hasFailure } from '@/lib/price-utils';

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
  const { data: sparklineMap } = useSparklines(7);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ChangeFilter>('all');
  const [view, setView] = useState<ViewMode>('table');

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
    } catch {
      /* ignore */
    }
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
      setCollectStatus({ status: 'pending' });
      pollRef.current = setInterval(pollStatus, 3000);
    } catch {
      setCollectStatus({
        status: 'failed',
        error_message: '수집 요청 중 오류가 발생했습니다.',
      });
    } finally {
      setCollecting(false);
    }
  };

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

  const isActive =
    collectStatus?.status === 'pending' || collectStatus?.status === 'running';

  // 검색 + 필터 적용
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((item) => {
      if (q && !item.product_name.toLowerCase().includes(q)) return false;
      if (filter === 'changed' && !hasAnyChange(item)) return false;
      if (filter === 'bigDrop' && !hasBigDrop(item)) return false;
      if (filter === 'failed' && !hasFailure(item)) return false;
      return true;
    });
  }, [data, search, filter]);

  // 필터별 카운트 (검색 적용 후 기준)
  const counts = useMemo(() => {
    const base = data.filter((item) =>
      search.trim()
        ? item.product_name.toLowerCase().includes(search.trim().toLowerCase())
        : true
    );
    return {
      all: base.length,
      changed: base.filter(hasAnyChange).length,
      bigDrop: base.filter((i) => hasBigDrop(i)).length,
      failed: base.filter(hasFailure).length,
    } as const;
  }, [data, search]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">현재 최저가 요약</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleCollect}
            disabled={collecting || isActive}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {collecting ? '요청 중...' : isActive ? '수집 중...' : '즉시 수집'}
          </button>
          <button
            onClick={() => {
              stopPolling();
              refetch();
            }}
            className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
          >
            새로고침
          </button>
        </div>
      </div>

      {collectStatus && collectStatus.status !== 'idle' && (
        <div
          className={`mb-4 p-3 rounded-lg border text-sm ${
            collectStatus.status === 'completed'
              ? 'bg-green-50 border-green-200 text-green-700'
              : collectStatus.status === 'failed'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-blue-50 border-blue-200 text-blue-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {isActive && (
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            )}
            <span>{statusMessage()}</span>
          </div>
        </div>
      )}

      {loading && <div className="text-center py-12 text-gray-500">로딩 중...</div>}

      {error && <div className="text-center py-12 text-red-500">오류: {error}</div>}

      {!loading && !error && data.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          등록된 상품이 없습니다. 상품 관리에서 상품을 추가해주세요.
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <>
          <SummaryCards data={data} />

          <div className="mb-4 flex flex-wrap items-center gap-3 justify-between">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <SearchInput value={search} onChange={setSearch} />
              <FilterChips value={filter} onChange={setFilter} counts={counts} />
            </div>
            <ViewToggle value={view} onChange={setView} />
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border p-12 text-center text-gray-400">
              조건에 맞는 상품이 없습니다.
            </div>
          ) : view === 'table' ? (
            <div className="bg-white rounded-lg shadow-sm border">
              <PriceTable data={filtered} sparklineMap={sparklineMap} />
            </div>
          ) : (
            <PriceCardList data={filtered} sparklineMap={sparklineMap} />
          )}
        </>
      )}
    </div>
  );
}
