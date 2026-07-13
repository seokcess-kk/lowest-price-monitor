'use client';

import { useState, useEffect, useMemo } from 'react';
import { useProductList } from '@/hooks/useProductList';
import {
  useUrlState,
  stringCodec,
  stringSetCodec,
  enumCodec,
} from '@/hooks/useUrlState';
import DateRangePicker from '@/components/DateRangePicker';
import BrandFilter from '@/components/BrandFilter';
import { exportToExcel } from '@/lib/export';
import { useToast } from '@/components/Toast';
import type { ExportRequest, ExportRow, ProductIdsResponse } from '@/types/database';

const STORAGE_KEY = 'export:lastSelectedIds';
const LIST_PAGE_SIZE = 50;
/** 이 수를 넘는 선택은 칩 대신 개수 요약만 표시 (이름을 모두 들고 있지 않음) */
const CHIP_DISPLAY_LIMIT = 50;
/** 원본(raw) 모드 조회 가능 개월 수 — 서버(api/export)와 일치 */
const RAW_RETENTION_MONTHS = 6;

type ActiveFilter = 'all' | 'active' | 'inactive';
type ExportMode = 'raw' | 'daily';
const ACTIVE_CODEC = enumCodec<ActiveFilter>(['all', 'active', 'inactive'], 'all');
const MODE_CODEC = enumCodec<ExportMode>(['raw', 'daily'], 'raw');

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function startOfMonthISO() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().split('T')[0];
}

function rawCutoffISO() {
  const d = new Date();
  d.setMonth(d.getMonth() - RAW_RETENTION_MONTHS);
  return d.toISOString().split('T')[0];
}

/** 선택 상태 — id → 상품명(모르면 null). 이름은 칩 표시용으로만 쓴다 */
type SelectionMap = Map<string, string | null>;

function loadSavedSelection(): SelectionMap {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return new Map();
    const parsed = JSON.parse(saved) as Array<string | { id: string; name?: string | null }>;
    const map: SelectionMap = new Map();
    for (const item of parsed) {
      // 구버전 포맷(string[]) 호환
      if (typeof item === 'string') map.set(item, null);
      else if (item && typeof item.id === 'string') map.set(item.id, item.name ?? null);
    }
    return map;
  } catch {
    return new Map();
  }
}

export default function ExportPage() {
  const toast = useToast();
  const [startDate, setStartDate] = useState(() => daysAgoISO(30));
  const [endDate, setEndDate] = useState(todayISO);
  const [selected, setSelected] = useState<SelectionMap>(new Map());
  const [hydrated, setHydrated] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [bulkSelecting, setBulkSelecting] = useState(false);

  const [search, setSearchRaw] = useUrlState('q', '', stringCodec);
  const [activeFilter, setActiveFilterRaw] = useUrlState<ActiveFilter>(
    'status',
    'all',
    ACTIVE_CODEC
  );
  const [brandSelection, setBrandSelectionRaw] = useUrlState(
    'brand',
    new Set<string>(),
    stringSetCodec
  );
  const [mode, setMode] = useUrlState<ExportMode>('mode', 'raw', MODE_CODEC);
  const [listPage, setListPage] = useState(1);

  const setSearch = (v: string) => {
    setSearchRaw(v);
    setListPage(1);
  };
  const setActiveFilter = (v: ActiveFilter) => {
    setActiveFilterRaw(v);
    setListPage(1);
  };
  const setBrandSelection = (next: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setBrandSelectionRaw(next);
    setListPage(1);
  };

  const brandIdsArr = useMemo(() => [...brandSelection].sort(), [brandSelection]);
  // 상품 선택 리스트 — 서버 검색 + 페이지. facets는 BrandFilter 카운트용
  const {
    items: products,
    total: productTotal,
    facets,
    loading: productsLoading,
  } = useProductList({
    page: listPage,
    pageSize: LIST_PAGE_SIZE,
    q: search,
    status: activeFilter,
    brandIds: brandIdsArr,
    includeFacets: true,
  });

  // 예상 행 수 — 필터 변경 후 디바운스로 count_only 호출
  const [estCount, setEstCount] = useState<number | null>(null);
  const [estLoading, setEstLoading] = useState(false);

  // localStorage에서 마지막 선택 복원
  useEffect(() => {
    setSelected(loadSavedSelection());
    setHydrated(true);
  }, []);

  // 선택이 바뀔 때마다 저장 ({id, name} 쌍 — 전체 목록 없이도 칩 이름 복원)
  useEffect(() => {
    if (!hydrated) return;
    try {
      const entries = Array.from(selected.entries()).map(([id, name]) => ({ id, name }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {}
  }, [selected, hydrated]);

  const selectAll = selected.size === 0;
  const rawTooOld = mode === 'raw' && startDate < rawCutoffISO();

  const toggleProduct = (id: string, name: string | null) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });
  };

  /** 현재 필터(검색/상태/브랜드)에 해당하는 전체 id 조회 */
  const fetchFilteredIds = async (statusOverride?: ActiveFilter): Promise<string[] | null> => {
    const params = new URLSearchParams();
    if (statusOverride === undefined) {
      if (search.trim()) params.set('q', search.trim());
      if (activeFilter !== 'all') params.set('status', activeFilter);
      if (brandIdsArr.length > 0) params.set('brand_ids', brandIdsArr.join(','));
    } else if (statusOverride !== 'all') {
      params.set('status', statusOverride);
    }
    const res = await fetch(`/api/products/ids?${params.toString()}`);
    if (!res.ok) return null;
    const body = (await res.json()) as ProductIdsResponse;
    return body.ids;
  };

  const runBulkSelect = async (fn: () => Promise<void>) => {
    setBulkSelecting(true);
    try {
      await fn();
    } catch {
      toast.error('선택 처리 실패');
    } finally {
      setBulkSelecting(false);
    }
  };

  const selectFilteredAll = () =>
    runBulkSelect(async () => {
      const ids = await fetchFilteredIds();
      if (!ids) {
        toast.error('검색결과 전체 선택 실패');
        return;
      }
      setSelected((prev) => {
        const next = new Map(prev);
        const nameById = new Map(products.map((p) => [p.id, p.name]));
        ids.forEach((id) => {
          if (!next.has(id)) next.set(id, nameById.get(id) ?? null);
        });
        return next;
      });
    });

  const deselectFilteredAll = () =>
    runBulkSelect(async () => {
      const ids = await fetchFilteredIds();
      if (!ids) {
        toast.error('검색결과 해제 실패');
        return;
      }
      setSelected((prev) => {
        const next = new Map(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    });

  const selectActiveOnly = () =>
    runBulkSelect(async () => {
      const ids = await fetchFilteredIds('active');
      if (!ids) {
        toast.error('활성 상품 선택 실패');
        return;
      }
      setSelected(new Map(ids.map((id) => [id, null])));
    });

  const clearSelection = () => setSelected(new Map());

  const buildRequest = (countOnly: boolean): ExportRequest => ({
    start_date: startDate,
    end_date: endDate,
    mode,
    count_only: countOnly,
    ...(selectAll ? {} : { product_ids: Array.from(selected.keys()) }),
  });

  // 필터 변경 시 디바운스 (500ms) 후 예상 행 수 조회
  useEffect(() => {
    if (!hydrated) return;
    if (rawTooOld) {
      setEstCount(null);
      setEstLoading(false);
      return;
    }
    setEstCount(null);
    setEstLoading(true);
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildRequest(true)),
        });
        if (!res.ok) {
          setEstCount(null);
          return;
        }
        const body = (await res.json()) as { rawCount: number };
        setEstCount(body.rawCount ?? 0);
      } catch {
        setEstCount(null);
      } finally {
        setEstLoading(false);
      }
    }, 500);
    return () => {
      window.clearTimeout(handle);
      setEstLoading(false);
    };
    // buildRequest는 아래 상태들의 순수 함수
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, startDate, endDate, mode, selectAll, selected, rawTooOld]);

  const fetchData = async (): Promise<ExportRow[]> => {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequest(false)),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error || 'Export 데이터 조회 실패');
    }
    return res.json();
  };

  const runDownload = async () => {
    setDownloading(true);
    try {
      const data = await fetchData();
      if (data.length === 0) {
        toast.show('해당 기간에 데이터가 없습니다.', 'info');
        return;
      }
      const suffix = mode === 'daily' ? '_일별최저가' : '';
      await exportToExcel(data, `최저가_${startDate}_${endDate}${suffix}`);
      toast.success(`${data.length}건 다운로드 완료`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export 실패');
    } finally {
      setDownloading(false);
    }
  };

  const presets: { label: string; apply: () => void }[] = [
    { label: '오늘', apply: () => { setStartDate(todayISO()); setEndDate(todayISO()); } },
    { label: '최근 7일', apply: () => { setStartDate(daysAgoISO(7)); setEndDate(todayISO()); } },
    { label: '최근 30일', apply: () => { setStartDate(daysAgoISO(30)); setEndDate(todayISO()); } },
    { label: '최근 90일', apply: () => { setStartDate(daysAgoISO(90)); setEndDate(todayISO()); } },
    { label: '이번 달', apply: () => { setStartDate(startOfMonthISO()); setEndDate(todayISO()); } },
  ];

  const selectedProductChips = useMemo(() => {
    if (selectAll || selected.size > CHIP_DISPLAY_LIMIT) return [];
    // 현재 페이지에서 이름을 알게 된 상품은 이름을 채워 넣는다
    const nameById = new Map(products.map((p) => [p.id, p.name]));
    return Array.from(selected.entries()).map(([id, name]) => ({
      id,
      name: name ?? nameById.get(id) ?? '(이름 미확인 상품)',
    }));
  }, [selectAll, selected, products]);

  const listTotalPages = Math.max(1, Math.ceil(productTotal / LIST_PAGE_SIZE));
  const noSelection = false; // 선택 0개 = 전체 export (기존 동작 유지)
  const brandCounts = {
    byId: facets?.brands ?? {},
    uncategorized: facets?.uncategorized ?? 0,
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">데이터 Export</h1>

      {/* 기간 선택 */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">기간 선택</h2>
        <div className="flex flex-wrap gap-2 mb-4">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={p.apply}
              className="px-3 py-1.5 text-sm rounded-full border border-gray-300 hover:bg-gray-100 text-gray-700"
            >
              {p.label}
            </button>
          ))}
        </div>
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
        />
        {rawTooOld && (
          <div className="mt-3 flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            <span>
              원본 로그는 최근 {RAW_RETENTION_MONTHS}개월만 보관됩니다. 그 이전 기간은 일별
              요약으로 내려받으세요.
            </span>
            <button
              onClick={() => setMode('daily')}
              className="shrink-0 px-2 py-1 text-xs border border-amber-300 bg-white rounded hover:bg-amber-100"
            >
              일별 요약으로 전환
            </button>
          </div>
        )}
      </div>

      {/* 상품 선택 */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">상품 선택</h2>
          <span className="text-sm text-gray-500">
            {selectAll ? '전체 상품' : `${selected.size.toLocaleString('ko-KR')}개 선택`}
          </span>
        </div>

        {/* 검색 + 필터 */}
        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상품명·사방넷코드·브랜드 검색..."
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
          <div className="flex gap-1">
            {(['all', 'active', 'inactive'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`px-3 py-2 text-sm rounded-md border ${
                  activeFilter === f
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {f === 'all' ? '전체' : f === 'active' ? '활성' : '비활성'}
              </button>
            ))}
          </div>
          <BrandFilter
            selected={brandSelection}
            onChange={setBrandSelection}
            counts={brandCounts.byId}
            uncategorizedCount={brandCounts.uncategorized}
          />
        </div>

        {/* 빠른 액션 — 필터 결과 전체는 서버에서 id만 조회 */}
        <div className="flex flex-wrap gap-2 mb-3 text-sm">
          <button
            onClick={selectFilteredAll}
            disabled={bulkSelecting}
            className="px-2 py-1 text-blue-600 hover:underline disabled:opacity-50"
          >
            검색결과 전체 선택 ({productTotal.toLocaleString('ko-KR')})
          </button>
          <button
            onClick={deselectFilteredAll}
            disabled={bulkSelecting}
            className="px-2 py-1 text-blue-600 hover:underline disabled:opacity-50"
          >
            검색결과 해제
          </button>
          <button
            onClick={selectActiveOnly}
            disabled={bulkSelecting}
            className="px-2 py-1 text-blue-600 hover:underline disabled:opacity-50"
          >
            활성 상품만 선택
          </button>
          <button
            onClick={clearSelection}
            disabled={bulkSelecting}
            className="px-2 py-1 text-blue-600 hover:underline disabled:opacity-50"
          >
            전체 선택(필터 없음)
          </button>
          {bulkSelecting && <span className="text-gray-400">처리 중…</span>}
        </div>

        {/* 선택된 상품 칩 — 많으면 개수 요약만 */}
        {!selectAll && selected.size > CHIP_DISPLAY_LIMIT && (
          <div className="p-2 mb-3 bg-gray-50 rounded-md text-xs text-gray-600">
            {selected.size.toLocaleString('ko-KR')}개 상품이 선택되어 있습니다.
          </div>
        )}
        {selectedProductChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 p-2 mb-3 bg-gray-50 rounded-md max-h-24 overflow-y-auto">
            {selectedProductChips.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-gray-200 rounded-full text-xs text-gray-700"
              >
                {c.name}
                <button
                  onClick={() => toggleProduct(c.id, null)}
                  className="text-gray-400 hover:text-gray-700"
                  aria-label={`${c.name} 제거`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 상품 리스트 (서버 페이지) */}
        <div className="border border-gray-200 rounded-md max-h-72 overflow-y-auto divide-y divide-gray-100">
          {productsLoading ? (
            <div className="p-4 text-sm text-gray-500 text-center">로딩 중...</div>
          ) : products.length === 0 ? (
            <div className="p-4 text-sm text-gray-500 text-center">검색 결과가 없습니다.</div>
          ) : (
            products.map((product) => {
              const checked = selectAll || selected.has(product.id);
              return (
                <label
                  key={product.id}
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleProduct(product.id, product.name)}
                    className="w-4 h-4"
                  />
                  <span className="flex-1 text-sm text-gray-800 truncate">
                    {product.brand_name && (
                      <span className="text-[10px] font-semibold text-purple-700 mr-1.5">
                        [{product.brand_name}]
                      </span>
                    )}
                    {product.name}
                  </span>
                  {!product.is_active && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-gray-200 text-gray-600 rounded">
                      비활성
                    </span>
                  )}
                </label>
              );
            })
          )}
        </div>
        {listTotalPages > 1 && (
          <div className="mt-2 flex items-center justify-center gap-3 text-xs text-gray-600">
            <button
              onClick={() => setListPage((p) => Math.max(1, p - 1))}
              disabled={listPage <= 1}
              className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-40"
            >
              ← 이전
            </button>
            <span className="tabular-nums">
              {listPage} / {listTotalPages}
            </span>
            <button
              onClick={() => setListPage((p) => Math.min(listTotalPages, p + 1))}
              disabled={listPage >= listTotalPages}
              className="px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-40"
            >
              다음 →
            </button>
          </div>
        )}
      </div>

      {/* 출력 형식 */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">출력 형식</h2>
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              checked={mode === 'raw'}
              onChange={() => setMode('raw')}
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">
                전체 수집 로그 (모든 시점)
              </div>
              <div className="text-xs text-gray-500">
                기간 내 수집된 모든 가격 기록을 그대로 출력합니다. 최근{' '}
                {RAW_RETENTION_MONTHS}개월 이내 기간만 지원합니다.
              </div>
            </div>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              checked={mode === 'daily'}
              onChange={() => setMode('daily')}
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">
                일별 최저가 요약 (날짜·상품·채널당 1행)
              </div>
              <div className="text-xs text-gray-500">
                날짜·상품·채널별 최저가 1건만 남깁니다. 기간 제한 없이 전체 이력을 지원합니다.
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* 다운로드 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={runDownload}
          disabled={downloading || noSelection || rawTooOld}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {downloading ? '처리 중...' : 'Excel 다운로드'}
        </button>
        <span className="text-sm text-gray-600" aria-live="polite">
          {rawTooOld ? (
            <span className="text-amber-700">
              기간이 원본 보관 범위를 벗어났습니다 — 일별 요약 모드를 사용하세요.
            </span>
          ) : estLoading ? (
            <span className="text-gray-400">예상 행 수 계산 중…</span>
          ) : estCount === null ? (
            <span className="text-gray-400">예상 행 수 -</span>
          ) : (
            <>
              예상 <strong className="tabular-nums">{estCount.toLocaleString('ko-KR')}</strong>행
              {estCount > 50000 && (
                <span className="ml-2 text-amber-700 text-xs">
                  ⚠ 행이 많아 Excel 열기가 느릴 수 있습니다
                </span>
              )}
            </>
          )}
        </span>
      </div>
    </div>
  );
}
