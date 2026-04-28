'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Brand } from '@/types/database';
import { normalizeBrand } from '@/lib/brand-utils';

interface Props {
  /** 현재 선택된 브랜드명 (자유 입력) */
  value: string;
  onChange: (next: string) => void;
  /** 외부에서 미리 받은 브랜드 목록 — 미지정 시 자체 fetch */
  brands?: Brand[];
  placeholder?: string;
}

/**
 * 자동완성 가능한 브랜드 입력 — 기존 브랜드 검색 + 신규 추가.
 * 검증은 서버에서 하므로 여기서는 표기 그대로 onChange.
 */
export default function BrandCombobox({
  value,
  onChange,
  brands: brandsProp,
  placeholder = '브랜드명 검색 또는 신규 입력',
}: Props) {
  const [internalBrands, setInternalBrands] = useState<Brand[]>([]);
  const brands = brandsProp ?? internalBrands;
  const [open, setOpen] = useState(false);
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

  const candidates = useMemo(() => {
    const key = normalizeBrand(value);
    if (!key) return brands.slice(0, 8);
    return brands
      .filter((b) => normalizeBrand(b.name).includes(key))
      .slice(0, 8);
  }, [brands, value]);

  const exactHit = useMemo(() => {
    if (!value.trim()) return null;
    const key = normalizeBrand(value);
    return brands.find((b) => normalizeBrand(b.name) === key) ?? null;
  }, [brands, value]);

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
        placeholder={placeholder}
        autoComplete="off"
      />
      {value && (
        <div className="mt-1 text-xs">
          {exactHit ? (
            <span className="text-green-700">✓ 기존 브랜드: {exactHit.name}</span>
          ) : (
            <span className="text-blue-700">🆕 신규 브랜드로 추가됨</span>
          )}
        </div>
      )}
      {open && candidates.length > 0 && (
        <ul className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
          {candidates.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(b.name);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 text-gray-800"
              >
                {b.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
