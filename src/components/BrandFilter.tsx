'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Brand } from '@/types/database';

interface Props {
  /** 선택된 brand_id 집합. 빈 Set이면 "전체"로 간주 */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** 외부에서 받은 브랜드 목록 — 미지정 시 자체 fetch */
  brands?: Brand[];
  /** 옵션 옆에 카운트(상품 수) 표시 */
  counts?: Record<string, number>;
  /** brand_id가 NULL인 미분류 상품 카운트 (있으면 옵션 노출) */
  uncategorizedCount?: number;
}

const UNCATEGORIZED = '__none__';

/**
 * 브랜드 멀티 선택 드롭다운.
 * 선택 0개 = 전체. 미분류(brand_id IS NULL) 상품이 있으면 가상 옵션 노출.
 * "미분류"가 선택되면 호출 측에서 별도 분기 처리해야 한다 (ID === '__none__').
 */
export default function BrandFilter({
  selected,
  onChange,
  brands: brandsProp,
  counts,
  uncategorizedCount,
}: Props) {
  const [internalBrands, setInternalBrands] = useState<Brand[]>([]);
  const brands = brandsProp ?? internalBrands;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (brandsProp) return;
    let cancelled = false;
    fetch('/api/brands')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setInternalBrands(data as Brand[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [brandsProp]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => b.name.toLowerCase().includes(q));
  }, [brands, query]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const clear = () => onChange(new Set());

  const label = (() => {
    if (selected.size === 0) return '브랜드: 전체';
    if (selected.size === 1) {
      const id = Array.from(selected)[0];
      if (id === UNCATEGORIZED) return '브랜드: 미분류';
      const b = brands.find((x) => x.id === id);
      return `브랜드: ${b?.name ?? '1개'}`;
    }
    return `브랜드: ${selected.size}개`;
  })();

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
          selected.size > 0
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
        }`}
      >
        {label} ▾
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 max-h-80 overflow-hidden bg-white border border-gray-200 rounded-md shadow-lg flex flex-col">
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="브랜드 검색..."
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {selected.size > 0 && (
              <button
                type="button"
                onClick={clear}
                className="w-full text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 border-b border-gray-100"
              >
                선택 해제 (전체 보기)
              </button>
            )}
            {uncategorizedCount !== undefined && uncategorizedCount > 0 && (
              <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(UNCATEGORIZED)}
                  onChange={() => toggle(UNCATEGORIZED)}
                />
                <span className="flex-1 text-gray-500 italic">미분류</span>
                <span className="text-xs text-gray-400">{uncategorizedCount}</span>
              </label>
            )}
            {filtered.length === 0 ? (
              <div className="p-3 text-xs text-gray-400 text-center">
                결과가 없습니다.
              </div>
            ) : (
              filtered.map((b) => (
                <label
                  key={b.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(b.id)}
                    onChange={() => toggle(b.id)}
                  />
                  <span className="flex-1 text-gray-800 truncate" title={b.name}>
                    {b.name}
                  </span>
                  {counts && (
                    <span className="text-xs text-gray-400">{counts[b.id] ?? 0}</span>
                  )}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const UNCATEGORIZED_BRAND_ID = UNCATEGORIZED;
