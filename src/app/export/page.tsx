'use client';

import { useState, useEffect, useMemo } from 'react';
import { useProducts } from '@/hooks/useProducts';
import DateRangePicker from '@/components/DateRangePicker';
import BrandFilter, { UNCATEGORIZED_BRAND_ID } from '@/components/BrandFilter';
import { exportToExcel } from '@/lib/export';

interface ExportRow {
  date: string;
  productName: string;
  sabangnetCode: string | null;
  brandName: string | null;
  channel: string;
  price: number;
  storeName: string | null;
}

const STORAGE_KEY = 'export:lastSelectedIds';

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

export default function ExportPage() {
  const { products, loading: productsLoading } = useProducts(false);
  const [startDate, setStartDate] = useState(() => daysAgoISO(30));
  const [endDate, setEndDate] = useState(todayISO);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [brandSelection, setBrandSelection] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'raw' | 'daily'>('raw');

  // localStorage에서 마지막 선택 복원
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const ids: string[] = JSON.parse(saved);
        setSelectedIds(new Set(ids));
      }
    } catch {}
    setHydrated(true);
  }, []);

  // 선택이 바뀔 때마다 저장
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selectedIds)));
    } catch {}
  }, [selectedIds, hydrated]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (activeFilter === 'active' && !p.is_active) return false;
      if (activeFilter === 'inactive' && p.is_active) return false;
      if (q) {
        const nameHit = p.name.toLowerCase().includes(q);
        const brandHit = (p.brand_name ?? '').toLowerCase().includes(q);
        if (!nameHit && !brandHit) return false;
      }
      if (brandSelection.size > 0) {
        if (p.brand_id) {
          if (!brandSelection.has(p.brand_id)) return false;
        } else if (!brandSelection.has(UNCATEGORIZED_BRAND_ID)) return false;
      }
      return true;
    });
  }, [products, search, activeFilter, brandSelection]);

  const brandCounts = useMemo(() => {
    const map: Record<string, number> = {};
    let uncategorized = 0;
    for (const p of products) {
      if (p.brand_id) map[p.brand_id] = (map[p.brand_id] ?? 0) + 1;
      else uncategorized++;
    }
    return { byId: map, uncategorized };
  }, [products]);

  const selectAll = selectedIds.size === 0;

  const toggleProduct = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectFilteredAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredProducts.forEach((p) => next.add(p.id));
      return next;
    });
  };

  const deselectFilteredAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredProducts.forEach((p) => next.delete(p.id));
      return next;
    });
  };

  const selectActiveOnly = () => {
    setSelectedIds(new Set(products.filter((p) => p.is_active).map((p) => p.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const fetchData = async (): Promise<ExportRow[]> => {
    const params = new URLSearchParams({ start_date: startDate, end_date: endDate, mode });
    if (!selectAll && selectedIds.size > 0) {
      params.set('product_ids', Array.from(selectedIds).join(','));
    }
    const res = await fetch(`/api/export?${params.toString()}`);
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
        alert('해당 기간에 데이터가 없습니다.');
        return;
      }
      const suffix = mode === 'daily' ? '_일별최저가' : '';
      await exportToExcel(data, `최저가_${startDate}_${endDate}${suffix}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export 실패');
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
    if (selectAll) return [];
    const map = new Map(products.map((p) => [p.id, p.name]));
    return Array.from(selectedIds).map((id) => ({ id, name: map.get(id) || id }));
  }, [selectAll, selectedIds, products]);

  const noSelection = !selectAll && selectedIds.size === 0;

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
      </div>

      {/* 상품 선택 */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">상품 선택</h2>
          <span className="text-sm text-gray-500">
            {selectAll ? `전체 ${products.length}개` : `${selectedIds.size}개 선택`}
          </span>
        </div>

        {productsLoading ? (
          <div className="text-gray-500">로딩 중...</div>
        ) : (
          <>
            {/* 검색 + 필터 */}
            <div className="flex flex-wrap gap-2 mb-3 items-center">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="상품명·브랜드 검색..."
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

            {/* 빠른 액션 */}
            <div className="flex flex-wrap gap-2 mb-3 text-sm">
              <button onClick={selectFilteredAll} className="px-2 py-1 text-blue-600 hover:underline">
                검색결과 전체 선택 ({filteredProducts.length})
              </button>
              <button onClick={deselectFilteredAll} className="px-2 py-1 text-blue-600 hover:underline">
                검색결과 해제
              </button>
              <button onClick={selectActiveOnly} className="px-2 py-1 text-blue-600 hover:underline">
                활성 상품만 선택
              </button>
              <button onClick={clearSelection} className="px-2 py-1 text-blue-600 hover:underline">
                전체 선택(필터 없음)
              </button>
            </div>

            {/* 선택된 상품 칩 */}
            {selectedProductChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-2 mb-3 bg-gray-50 rounded-md max-h-24 overflow-y-auto">
                {selectedProductChips.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-gray-200 rounded-full text-xs text-gray-700"
                  >
                    {c.name}
                    <button
                      onClick={() => toggleProduct(c.id)}
                      className="text-gray-400 hover:text-gray-700"
                      aria-label={`${c.name} 제거`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* 상품 리스트 */}
            <div className="border border-gray-200 rounded-md max-h-72 overflow-y-auto divide-y divide-gray-100">
              {filteredProducts.length === 0 ? (
                <div className="p-4 text-sm text-gray-500 text-center">검색 결과가 없습니다.</div>
              ) : (
                filteredProducts.map((product) => {
                  const checked = selectAll || selectedIds.has(product.id);
                  return (
                    <label
                      key={product.id}
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProduct(product.id)}
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
          </>
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
              <div className="text-sm font-medium text-gray-900">원본 (raw)</div>
              <div className="text-xs text-gray-500">
                수집된 모든 로그를 그대로 출력합니다. 같은 채널을 하루에 여러 번 수집하면 행이 그만큼 늘어납니다.
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
              <div className="text-sm font-medium text-gray-900">일별 최저가 (daily)</div>
              <div className="text-xs text-gray-500">
                날짜 × 상품 × 채널 단위로 가장 낮은 가격 1행만 남깁니다.
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* 다운로드 */}
      <div className="flex gap-3">
        <button
          onClick={runDownload}
          disabled={downloading || noSelection}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {downloading ? '처리 중...' : 'Excel 다운로드'}
        </button>
      </div>
    </div>
  );
}
