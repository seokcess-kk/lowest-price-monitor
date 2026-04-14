'use client';

import { useState } from 'react';
import type { Product, CreateProductInput } from '@/types/database';

interface ProductFormProps {
  initialData?: Product;
  onSubmit: (data: CreateProductInput) => Promise<void>;
  onCancel?: () => void;
}

interface DupResponse {
  results: Array<{
    rowIndex: number;
    status: 'new' | 'duplicate' | 'similar' | 'sabangnet_conflict';
    duplicates: Array<{
      kind: 'urlMatch' | 'nameSimilar' | 'sabangnetMatch';
      productId: string;
      productName: string;
    }>;
  }>;
}

export default function ProductForm({ initialData, onSubmit, onCancel }: ProductFormProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [sabangnetCode, setSabangnetCode] = useState(initialData?.sabangnet_code || '');
  const [coupangUrl, setCoupangUrl] = useState(initialData?.coupang_url || '');
  const [naverUrl, setNaverUrl] = useState(initialData?.naver_url || '');
  const [danawaUrl, setDanawaUrl] = useState(initialData?.danawa_url || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      const payload: CreateProductInput = {
        name: name.trim(),
        sabangnet_code: sabangnetCode.trim() || null,
        coupang_url: coupangUrl.trim() || null,
        naver_url: naverUrl.trim() || null,
        danawa_url: danawaUrl.trim() || null,
      };

      // 사방넷코드가 입력된 경우만 충돌 체크 — 같은 코드가 다른 상품에 있으면 사용자 승인
      if (payload.sabangnet_code) {
        try {
          const res = await fetch('/api/products/check-duplicates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [
                {
                  rowIndex: 0,
                  name: payload.name,
                  sabangnet_code: payload.sabangnet_code,
                  excludeId: initialData?.id ?? null,
                },
              ],
            }),
          });
          if (res.ok) {
            const json: DupResponse = await res.json();
            const r = json.results?.[0];
            if (r?.status === 'sabangnet_conflict') {
              const other = r.duplicates.find((d) => d.kind === 'sabangnetMatch');
              const ok = window.confirm(
                `사방넷코드 "${payload.sabangnet_code}"가 이미 "${other?.productName ?? '다른 상품'}"에 등록되어 있습니다.\n\n그래도 이 상품에 같은 코드를 저장할까요?`
              );
              if (!ok) {
                setLoading(false);
                return;
              }
            }
          }
        } catch {
          /* 중복 확인 실패는 폼 제출을 막지 않는다 */
        }
      }

      await onSubmit(payload);
      if (!initialData) {
        setName('');
        setSabangnetCode('');
        setCoupangUrl('');
        setNaverUrl('');
        setDanawaUrl('');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">상품명 *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          placeholder="상품명을 입력하세요"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          사방넷코드
          <span className="ml-1 text-xs text-gray-400 font-normal">(선택)</span>
        </label>
        <input
          type="text"
          value={sabangnetCode}
          onChange={(e) => setSabangnetCode(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          placeholder="예: SB-12345"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#E44232' }} />
          쿠팡 URL
        </label>
        <input
          type="url"
          value={coupangUrl}
          onChange={(e) => setCoupangUrl(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          placeholder="https://www.coupang.com/..."
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#03C75A' }} />
          네이버 URL
        </label>
        <input
          type="url"
          value={naverUrl}
          onChange={(e) => setNaverUrl(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          placeholder="https://search.shopping.naver.com/..."
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: '#0068B7' }} />
          다나와 URL
        </label>
        <input
          type="url"
          value={danawaUrl}
          onChange={(e) => setDanawaUrl(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          placeholder="https://prod.danawa.com/..."
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '처리 중...' : initialData ? '수정' : '등록'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
          >
            취소
          </button>
        )}
      </div>
    </form>
  );
}
