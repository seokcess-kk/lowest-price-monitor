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
      matchedField?: 'coupang_url' | 'naver_url' | 'danawa_url' | 'sabangnet_code';
    }>;
  }>;
}

const FIELD_LABELS: Record<string, string> = {
  coupang_url: '쿠팡 URL',
  naver_url: '네이버 URL',
  danawa_url: '다나와 URL',
};

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

      // URL 또는 사방넷코드 중복 확인
      // - URL 중복: 동일 상품을 두 번 등록하는 것이므로 완전 차단
      // - 사방넷코드 충돌: 다른 상품에 같은 ERP 코드가 있을 수 있음 → 사용자 승인 필요
      const hasAnyUrl =
        payload.coupang_url || payload.naver_url || payload.danawa_url;
      if (payload.sabangnet_code || hasAnyUrl) {
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
                  coupang_url: payload.coupang_url,
                  naver_url: payload.naver_url,
                  danawa_url: payload.danawa_url,
                  excludeId: initialData?.id ?? null,
                },
              ],
            }),
          });
          if (res.ok) {
            const json: DupResponse = await res.json();
            const r = json.results?.[0];

            // 1) URL 중복 차단 (여러 개일 수 있음)
            const urlMatches = r?.duplicates.filter((d) => d.kind === 'urlMatch') ?? [];
            if (urlMatches.length > 0) {
              const lines = urlMatches
                .map(
                  (d) =>
                    `· ${FIELD_LABELS[d.matchedField ?? ''] ?? d.matchedField}: "${d.productName}"`
                )
                .join('\n');
              window.alert(
                `다음 URL이 이미 다른 상품에 등록되어 있어 저장할 수 없습니다.\n\n${lines}\n\n해당 상품을 수정하거나, 다른 URL을 사용하세요.`
              );
              setLoading(false);
              return;
            }

            // 2) 사방넷코드 충돌 — 사용자 승인 시 기존 상품의 코드를 지우고
            //    현재 상품에만 재부여 (ownership 이전)
            if (r?.status === 'sabangnet_conflict') {
              const other = r.duplicates.find((d) => d.kind === 'sabangnetMatch');
              const ok = window.confirm(
                `사방넷코드 "${payload.sabangnet_code}"가 이미 "${other?.productName ?? '다른 상품'}"에 등록되어 있습니다.\n\n` +
                  `승인하면 "${other?.productName ?? '해당 상품'}"의 사방넷코드를 제거하고 이 상품에 이전합니다.\n\n계속할까요?`
              );
              if (!ok) {
                setLoading(false);
                return;
              }
              // 기존 상품의 sabangnet_code를 null로 clear
              if (other?.productId) {
                try {
                  const clearRes = await fetch(`/api/products/${other.productId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sabangnet_code: null }),
                  });
                  if (!clearRes.ok) {
                    const body = await clearRes.json().catch(() => ({}));
                    window.alert(
                      `기존 상품의 사방넷코드 제거에 실패했습니다: ${body.error ?? clearRes.statusText}`
                    );
                    setLoading(false);
                    return;
                  }
                } catch {
                  window.alert(
                    '기존 상품의 사방넷코드 제거 중 네트워크 오류가 발생했습니다. 다시 시도해주세요.'
                  );
                  setLoading(false);
                  return;
                }
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
