'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useDashboard } from '@/hooks/useDashboard';
import {
  useUrlState,
  stringCodec,
  stringSetCodec,
  enumCodec,
} from '@/hooks/useUrlState';
import PriceTable from '@/components/PriceTable';
import PriceCardList from '@/components/PriceCardList';
import SummaryCards from '@/components/SummaryCards';
import ActionPanels from '@/components/ActionPanels';
import ActiveFilterChips from '@/components/ActiveFilterChips';
import SearchInput from '@/components/SearchInput';
import FilterChips, { type ChangeFilter } from '@/components/FilterChips';
import BrandFilter, { UNCATEGORIZED_BRAND_ID } from '@/components/BrandFilter';
import ViewToggle, { type ViewMode } from '@/components/ViewToggle';
import { hasAnyChange, hasBigDrop, hasFailure } from '@/lib/price-utils';
import { exportSnapshotToExcel } from '@/lib/export';
import { KpiCardSkeleton, ProductCardSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';

// useUrlState용 안정 codec 참조 — 모듈 레벨로 빼두면 useEffect deps가 흔들리지 않음
const FILTER_CODEC = enumCodec<ChangeFilter>(
  ['all', 'changed', 'bigDrop', 'failed'],
  'all'
);
const VIEW_CODEC = enumCodec<ViewMode>(['card', 'table'], 'table');
const PAGE_SIZE_OPTIONS = ['50', '100', '200', 'all'] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];
const PAGE_SIZE_CODEC = enumCodec<PageSizeOption>(PAGE_SIZE_OPTIONS, '50');
const PAGE_CODEC = {
  parse: (raw: string | null) => {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : 1;
  },
  format: (value: number) => (value > 1 ? String(value) : null),
};

interface CollectStatus {
  id?: string;
  status: string;
  result_success?: number;
  result_failed?: number;
  error_message?: string;
  created_at?: string;
  completed_at?: string;
  progress_done?: number;
  progress_total?: number;
}

/** 상대 시간 포맷 — 'N분 전' / 'N시간 전' / 'N일 전' + 절대 시간 보조 */
function formatRelative(iso: string | null): { relative: string; absolute: string } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  let relative: string;
  if (min < 1) relative = '방금 전';
  else if (min < 60) relative = `${min}분 전`;
  else if (min < 60 * 24) relative = `${Math.floor(min / 60)}시간 전`;
  else relative = `${Math.floor(min / (60 * 24))}일 전`;
  const absolute = new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return { relative, absolute };
}

export default function Home() {
  const {
    latest: data,
    sparklines: sparklineMap,
    lastCollectedAt,
    loading,
    error,
    refetch: refetchDashboard,
  } = useDashboard(7);
  // 두 콜백 호출처를 그대로 두기 위해 분리된 함수명을 유지
  const refetch = refetchDashboard;
  const refetchLastCollected = refetchDashboard;

  const [search, setSearch] = useUrlState('q', '', stringCodec);
  const [filter, setFilter] = useUrlState<ChangeFilter>(
    'filter',
    'all',
    FILTER_CODEC
  );
  const [brandSelection, setBrandSelection] = useUrlState(
    'brand',
    new Set<string>(),
    stringSetCodec
  );
  const [view, setView] = useUrlState<ViewMode>('view', 'table', VIEW_CODEC);
  const [page, setPage] = useUrlState('page', 1, PAGE_CODEC);
  const [pageSize, setPageSize] = useUrlState<PageSizeOption>(
    'pageSize',
    '50',
    PAGE_SIZE_CODEC
  );

  const [collecting, setCollecting] = useState(false);
  const [collectStatus, setCollectStatus] = useState<CollectStatus | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const didResetPageRef = useRef(false);
  const [collectingIds, setCollectingIds] = useState<Set<string>>(new Set());
  const toast = useToast();

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
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem('collect_in_progress');
        }
        refetch();
        refetchLastCollected();
      }
    } catch {
      /* ignore */
    }
  }, [refetch, refetchLastCollected, stopPolling]);

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
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('collect_in_progress', '1');
      }
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

  // 마운트 시 진행 중인 수집이 있으면 자동으로 폴링 재시작 (탭 이동 후 복귀 대응).
  // 페이지 전환마다 매번 GET하던 동작을 가드: 진행 중 플래그가 있거나 마지막 체크 후 60초 경과 시에만 호출.
  useEffect(() => {
    let cancelled = false;
    const COLLECT_CHECK_TTL_MS = 60_000;
    const FLAG_KEY = 'collect_in_progress';
    const TS_KEY = 'collect_last_check_ts';

    const flag =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(FLAG_KEY) : null;
    const lastCheck =
      typeof window !== 'undefined'
        ? Number(window.sessionStorage.getItem(TS_KEY) || 0)
        : 0;
    const stale = Date.now() - lastCheck > COLLECT_CHECK_TTL_MS;
    if (!flag && !stale) return;

    fetch('/api/collect')
      .then((res) => res.json())
      .then((data: CollectStatus) => {
        if (cancelled) return;
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(TS_KEY, String(Date.now()));
        }
        if (data && (data.status === 'pending' || data.status === 'running')) {
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(FLAG_KEY, '1');
          }
          setCollectStatus(data);
          if (!pollRef.current) {
            pollRef.current = setInterval(pollStatus, 3000);
          }
        } else if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(FLAG_KEY);
        }
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [pollStatus]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const progressDone = collectStatus?.progress_done ?? 0;
  const progressTotal = collectStatus?.progress_total ?? 0;
  const progressPct =
    progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;

  const statusMessage = () => {
    if (!collectStatus) return null;
    switch (collectStatus.status) {
      case 'pending':
        return progressTotal > 0
          ? `수집 대기 중... (${progressDone}/${progressTotal} 상품)`
          : '수집 대기 중... GitHub Actions 시작을 기다리는 중';
      case 'running':
        return progressTotal > 0
          ? `수집 진행 중... ${progressDone} / ${progressTotal} 상품 완료`
          : '수집 진행 중...';
      case 'completed':
        return `수집 완료: ${collectStatus.result_success ?? 0}건 성공, ${collectStatus.result_failed ?? 0}건 실패`;
      case 'failed':
        return `수집 실패: ${collectStatus.error_message || '알 수 없는 오류'}`;
      default:
        return null;
    }
  };

  const isActive =
    collectStatus?.status === 'pending' || collectStatus?.status === 'running';

  const handleCollectProduct = useCallback(
    async (productId: string) => {
      if (isActive) {
        toast.error('전체 수집이 진행 중입니다.');
        return;
      }
      if (collectingIds.has(productId)) return;

      setCollectingIds((prev) => {
        const next = new Set(prev);
        next.add(productId);
        return next;
      });
      try {
        const res = await fetch(`/api/collect/product/${productId}`, {
          method: 'POST',
        });
        const body = await res.json();
        if (!res.ok) {
          toast.error(body.error || '수집 요청 실패');
          return;
        }
        const successCount = body.success ?? 0;
        const failedCount = body.failed ?? 0;
        if (successCount > 0 && failedCount === 0) {
          toast.success(`수집 완료: ${successCount}건 성공`);
        } else if (successCount > 0) {
          toast.show(
            `수집 완료: ${successCount}건 성공, ${failedCount}건 실패`,
            'info'
          );
        } else {
          toast.error(`수집 실패: 0건 성공, ${failedCount}건 실패`);
        }
        refetch();
        refetchLastCollected();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '수집 요청 중 오류');
      } finally {
        setCollectingIds((prev) => {
          const next = new Set(prev);
          next.delete(productId);
          return next;
        });
      }
    },
    [isActive, collectingIds, toast, refetch, refetchLastCollected]
  );

  // 검색·브랜드 매처를 useCallback으로 고정해 useMemo 의존성 정합 유지
  const matchSearch = useCallback(
    (item: (typeof data)[number], q: string) => {
      if (!q) return true;
      const nameHit = item.product_name.toLowerCase().includes(q);
      const codeHit = (item.sabangnet_code ?? '').toLowerCase().includes(q);
      const brandHit = (item.brand_name ?? '').toLowerCase().includes(q);
      return nameHit || codeHit || brandHit;
    },
    []
  );

  const matchBrand = useCallback(
    (item: (typeof data)[number]) => {
      if (brandSelection.size === 0) return true;
      if (item.brand_id) return brandSelection.has(item.brand_id);
      return brandSelection.has(UNCATEGORIZED_BRAND_ID);
    },
    [brandSelection]
  );

  // 브랜드 필터용 카운트 (검색 적용 후 기준)
  const brandCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = data.filter((item) => matchSearch(item, q));
    const map: Record<string, number> = {};
    let uncategorized = 0;
    for (const item of base) {
      if (item.brand_id) map[item.brand_id] = (map[item.brand_id] ?? 0) + 1;
      else uncategorized++;
    }
    return { byId: map, uncategorized };
  }, [data, search, matchSearch]);

  // 검색 + 브랜드 + 필터 적용
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((item) => {
      if (!matchSearch(item, q)) return false;
      if (!matchBrand(item)) return false;
      if (filter === 'changed' && !hasAnyChange(item)) return false;
      if (filter === 'bigDrop' && !hasBigDrop(item)) return false;
      if (filter === 'failed' && !hasFailure(item)) return false;
      return true;
    });
  }, [data, search, filter, matchSearch, matchBrand]);

  // 필터 칩 카운트 (검색 + 브랜드 적용 후 기준)
  const counts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = data.filter((item) => matchSearch(item, q) && matchBrand(item));
    return {
      all: base.length,
      changed: base.filter(hasAnyChange).length,
      bigDrop: base.filter((i) => hasBigDrop(i)).length,
      failed: base.filter(hasFailure).length,
    } as const;
  }, [data, search, matchSearch, matchBrand]);

  useEffect(() => {
    if (!didResetPageRef.current) {
      didResetPageRef.current = true;
      return;
    }
    setPage(1);
  }, [search, filter, brandSelection, pageSize, setPage]);

  const pageSizeNumber =
    pageSize === 'all' ? Math.max(filtered.length, 1) : Number(pageSize);
  const totalPages =
    pageSize === 'all'
      ? 1
      : Math.max(1, Math.ceil(filtered.length / pageSizeNumber));
  const safePage = Math.min(page, totalPages);
  const pageStart = pageSize === 'all' ? 0 : (safePage - 1) * pageSizeNumber;
  const pageEnd =
    pageSize === 'all'
      ? filtered.length
      : Math.min(pageStart + pageSizeNumber, filtered.length);
  const paged = filtered.slice(pageStart, pageEnd);

  // 적용된 필터 칩 — 사용자가 무엇이 활성인지 즉시 인지하도록
  const activeChips = useMemo(() => {
    const items: Array<{
      label: string;
      tone?: 'search' | 'filter' | 'brand';
      onRemove?: () => void;
    }> = [];
    if (search.trim())
      items.push({
        label: `검색: "${search.trim()}"`,
        tone: 'search',
        onRemove: () => setSearch(''),
      });
    if (filter !== 'all') {
      const labels: Record<ChangeFilter, string> = {
        all: '전체',
        changed: '가격 변동',
        bigDrop: '5% 이상 하락',
        failed: '수집 실패',
      };
      items.push({
        label: labels[filter],
        tone: 'filter',
        onRemove: () => setFilter('all'),
      });
    }
    if (brandSelection.size > 0) {
      const idToName = new Map<string, string>();
      for (const item of data) {
        if (item.brand_id && item.brand_name && !idToName.has(item.brand_id)) {
          idToName.set(item.brand_id, item.brand_name);
        }
      }
      for (const id of brandSelection) {
        const name = id === UNCATEGORIZED_BRAND_ID ? '미분류' : idToName.get(id) ?? '브랜드';
        items.push({
          label: `브랜드: ${name}`,
          tone: 'brand',
          onRemove: () => {
            setBrandSelection((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          },
        });
      }
    }
    return items;
  }, [
    search,
    filter,
    brandSelection,
    data,
    setSearch,
    setFilter,
    setBrandSelection,
  ]);

  const clearAllFilters = useCallback(() => {
    setSearch('');
    setFilter('all');
    setBrandSelection(new Set());
  }, [setSearch, setFilter, setBrandSelection]);

  const exportConditioned = useCallback(async () => {
    if (filtered.length === 0) {
      toast.show('선택 조건에 맞는 상품이 없습니다.', 'info');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    await exportSnapshotToExcel(filtered, `선택조건_현재최저가_${today}`);
  }, [filtered, toast]);

  const exportAll = useCallback(async () => {
    if (data.length === 0) {
      toast.show('내보낼 상품이 없습니다.', 'info');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    await exportSnapshotToExcel(data, `전체상품_현재최저가_${today}`);
  }, [data, toast]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 sm:mb-6 flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">현재 최저가 요약</h1>
          {(() => {
            const fmt = formatRelative(lastCollectedAt);
            return fmt ? (
              <span
                className="text-xs text-gray-500"
                title={`마지막 수집: ${fmt.absolute}`}
              >
                🕒 마지막 수집: {fmt.relative} · {fmt.absolute}
              </span>
            ) : null;
          })()}
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <button
            onClick={handleCollect}
            disabled={collecting || isActive}
            className="flex-1 sm:flex-none min-h-9 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {collecting ? '요청 중...' : isActive ? '수집 중...' : '즉시 수집'}
          </button>
          <button
            onClick={() => {
              stopPolling();
              refetch();
            }}
            className="flex-1 sm:flex-none min-h-9 px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {isActive && (
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              )}
              <span>{statusMessage()}</span>
            </div>
            {isActive && progressTotal > 0 && (
              <span className="text-xs text-blue-600 font-medium">{progressPct}%</span>
            )}
          </div>
          {isActive && progressTotal > 0 && (
            <div className="mt-2 w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-500 h-1.5 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {loading && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <KpiCardSkeleton key={i} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </>
      )}

      {error && <div className="text-center py-12 text-red-500">오류: {error}</div>}

      {!loading && !error && data.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          등록된 상품이 없습니다. 상품 관리에서 상품을 추가해주세요.
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <>
          <SummaryCards data={data} />

          <ActionPanels
            data={data}
            onProductClick={(productId) => {
              const item = data.find((d) => d.product_id === productId);
              if (item) setSearch(item.product_name);
            }}
          />

          <div className="sticky top-14 z-20 -mx-3 sm:-mx-4 px-3 sm:px-4 py-3 mb-4 bg-gray-50/95 backdrop-blur border-y border-gray-200 flex flex-wrap items-center gap-3 justify-between">
            <div className="flex flex-wrap items-center gap-3 flex-1 w-full">
              <SearchInput value={search} onChange={setSearch} />
              <FilterChips value={filter} onChange={setFilter} counts={counts} />
              <BrandFilter
                selected={brandSelection}
                onChange={setBrandSelection}
                counts={brandCounts.byId}
                uncategorizedCount={brandCounts.uncategorized}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
              <ExportButtons
                filteredCount={filtered.length}
                totalCount={data.length}
                onExportConditioned={exportConditioned}
                onExportAll={exportAll}
              />
            </div>
            {/* 모바일에서는 카드 뷰만, 데스크톱에서는 토글 노출 */}
            <div className="hidden md:block">
              <ViewToggle value={view} onChange={setView} />
            </div>
          </div>

          <ActiveFilterChips
            items={activeChips}
            onClearAll={activeChips.length > 0 ? clearAllFilters : undefined}
            matchedCount={filtered.length}
            totalCount={data.length}
          />

          {filtered.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border p-12 text-center text-gray-400">
              조건에 맞는 상품이 없습니다.
            </div>
          ) : (
            <>
              <PaginationBar
                totalCount={filtered.length}
                pageStart={pageStart}
                pageEnd={pageEnd}
                page={safePage}
                totalPages={totalPages}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
              {/* 모바일은 항상 카드 뷰 */}
              <div className="md:hidden">
                <PriceCardList
                  data={paged}
                  sparklineMap={sparklineMap}
                  collectingIds={collectingIds}
                  globalCollecting={isActive}
                  onCollectProduct={handleCollectProduct}
                />
              </div>
              {/* 데스크톱은 토글에 따라 */}
              <div className="hidden md:block">
                {view === 'table' ? (
                  <div className="bg-white rounded-lg shadow-sm border">
                    <PriceTable
                      data={paged}
                      sparklineMap={sparklineMap}
                      collectingIds={collectingIds}
                      globalCollecting={isActive}
                      onCollectProduct={handleCollectProduct}
                    />
                  </div>
                ) : (
                  <PriceCardList
                  data={paged}
                  sparklineMap={sparklineMap}
                  collectingIds={collectingIds}
                  globalCollecting={isActive}
                  onCollectProduct={handleCollectProduct}
                />
                )}
              </div>
              <PaginationBar
                totalCount={filtered.length}
                pageStart={pageStart}
                pageEnd={pageEnd}
                page={safePage}
                totalPages={totalPages}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                compact
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

interface ExportButtonsProps {
  filteredCount: number;
  totalCount: number;
  onExportConditioned: () => void;
  onExportAll: () => void;
}

function ExportButtons({
  filteredCount,
  totalCount,
  onExportConditioned,
  onExportAll,
}: ExportButtonsProps) {
  const sameAsAll = filteredCount === totalCount;
  return (
    <div className="flex items-center gap-2 w-full sm:w-auto">
      <button
        type="button"
        onClick={onExportConditioned}
        disabled={filteredCount === 0}
        title="현재 검색어와 필터 조건에 맞는 상품을 모두 내보냅니다."
        className="flex-1 sm:flex-none min-h-9 px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-sm"
      >
        선택 조건 엑셀
        {sameAsAll && (
          <span className="ml-1 text-[11px] text-green-100">· 전체와 동일</span>
        )}
      </button>
      <button
        type="button"
        onClick={onExportAll}
        disabled={totalCount === 0}
        title="검색어와 필터를 무시하고 전체 상품을 내보냅니다."
        className="flex-1 sm:flex-none min-h-9 px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 text-sm"
      >
        전체 상품 엑셀
      </button>
    </div>
  );
}

interface PaginationBarProps {
  totalCount: number;
  pageStart: number;
  pageEnd: number;
  page: number;
  totalPages: number;
  pageSize: PageSizeOption;
  onPageChange: (next: number) => void;
  onPageSizeChange: (next: PageSizeOption) => void;
  compact?: boolean;
}

function PaginationBar({
  totalCount,
  pageStart,
  pageEnd,
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  compact = false,
}: PaginationBarProps) {
  const isAll = pageSize === 'all';
  const from = totalCount === 0 ? 0 : pageStart + 1;
  const to = totalCount === 0 ? 0 : pageEnd;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600 ${
        compact ? 'mt-3' : 'mb-3'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="tabular-nums">
          {from}-{to} / {totalCount}
        </span>
        <label className="inline-flex items-center gap-1 text-xs">
          <span className="text-gray-500">표시</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(e.target.value as PageSizeOption)}
            className="h-8 rounded border border-gray-300 bg-white px-2 text-xs text-gray-700"
          >
            <option value="50">50개</option>
            <option value="100">100개</option>
            <option value="200">200개</option>
            <option value="all">전체</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={page <= 1 || isAll}
          className="hidden sm:inline-flex min-h-8 px-2 items-center rounded border border-gray-300 bg-white disabled:opacity-30 hover:bg-gray-50"
        >
          처음
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1 || isAll}
          className="min-h-8 px-2 rounded border border-gray-300 bg-white disabled:opacity-30 hover:bg-gray-50"
        >
          이전
        </button>
        <span className="px-2 text-xs tabular-nums">
          {isAll ? '전체' : `${page} / ${totalPages}`}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages || isAll}
          className="min-h-8 px-2 rounded border border-gray-300 bg-white disabled:opacity-30 hover:bg-gray-50"
        >
          다음
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages || isAll}
          className="hidden sm:inline-flex min-h-8 px-2 items-center rounded border border-gray-300 bg-white disabled:opacity-30 hover:bg-gray-50"
        >
          마지막
        </button>
      </div>
    </div>
  );
}
