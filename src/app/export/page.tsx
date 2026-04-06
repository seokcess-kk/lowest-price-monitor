'use client';

import { useState } from 'react';
import { useProducts } from '@/hooks/useProducts';
import DateRangePicker from '@/components/DateRangePicker';
import { exportToCSV, exportToExcel } from '@/lib/export';

interface ExportRow {
  date: string;
  productName: string;
  channel: string;
  price: number;
  storeName: string | null;
}

export default function ExportPage() {
  const { products, loading: productsLoading } = useProducts(true);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedIds(new Set());
    }
  };

  const handleToggleProduct = (id: string) => {
    setSelectAll(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const fetchData = async (): Promise<ExportRow[]> => {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
    });

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

  const handleCSV = async () => {
    setDownloading(true);
    try {
      const data = await fetchData();
      if (data.length === 0) {
        alert('해당 기간에 데이터가 없습니다.');
        return;
      }
      exportToCSV(data, `최저가_${startDate}_${endDate}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export 실패');
    } finally {
      setDownloading(false);
    }
  };

  const handleExcel = async () => {
    setDownloading(true);
    try {
      const data = await fetchData();
      if (data.length === 0) {
        alert('해당 기간에 데이터가 없습니다.');
        return;
      }
      exportToExcel(data, `최저가_${startDate}_${endDate}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export 실패');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">데이터 Export</h1>

      {/* 기간 선택 */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">기간 선택</h2>
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
        />
      </div>

      {/* 상품 선택 */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">상품 선택</h2>

        {productsLoading ? (
          <div className="text-gray-500">로딩 중...</div>
        ) : (
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectAll}
                onChange={(e) => handleSelectAll(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="font-medium text-gray-900">전체 선택</span>
            </label>
            <div className="ml-6 space-y-1">
              {products.map((product) => (
                <label key={product.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectAll || selectedIds.has(product.id)}
                    onChange={() => handleToggleProduct(product.id)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-800">{product.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 다운로드 */}
      <div className="flex gap-3">
        <button
          onClick={handleCSV}
          disabled={downloading}
          className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
        >
          {downloading ? '처리 중...' : 'CSV 다운로드'}
        </button>
        <button
          onClick={handleExcel}
          disabled={downloading}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {downloading ? '처리 중...' : 'Excel 다운로드'}
        </button>
      </div>
    </div>
  );
}
