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

interface UrlValidation {
  ok: boolean;
  /** 차단 사유 (등록 막음) */
  error?: string;
  /** 진행은 가능하지만 가격 추출 실패 가능성 안내 */
  warning?: string;
}

/**
 * 등록 단계에서 URL 형식·필수 식별자를 검증한다.
 * - error: 호스트 불일치 / 패턴 미스 → 등록 차단
 * - warning: 등록은 허용하되 옵션 미지정 등으로 가격 추출이 실패할 수 있음을 안내
 *
 * 페이지 살아있는지(404·단종)는 여기서 알 수 없고, 등록 후 백그라운드 가격 검증이 보완한다.
 */
export function validateUrl(
  channel: 'coupang' | 'naver' | 'danawa',
  raw: string
): UrlValidation {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true }; // 비워두는 건 허용 (선택 입력)

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, error: '올바른 URL 형식이 아닙니다.' };
  }
  const host = u.hostname.toLowerCase();

  if (channel === 'coupang') {
    if (!host.endsWith('coupang.com'))
      return { ok: false, error: '쿠팡 도메인(coupang.com)이 아닙니다.' };
    if (!/\/(?:vp\/)?products\/\d+/.test(u.pathname))
      return {
        ok: false,
        error: '쿠팡 상품 URL 형식이 아닙니다. (/vp/products/{id} 형태)',
      };
    if (!u.searchParams.get('vendorItemId'))
      return {
        ok: true,
        warning:
          'vendorItemId가 없습니다. 옵션이 선택되지 않은 페이지로 인식되어 가격 추출이 실패할 수 있습니다.',
      };
    return { ok: true };
  }

  if (channel === 'naver') {
    if (!host.endsWith('naver.com'))
      return { ok: false, error: '네이버 도메인(naver.com)이 아닙니다.' };
    const isCatalog = /\/catalog\/\d+/.test(u.pathname);
    const isSmartstore = /^smartstore\./.test(host) || /^brand\./.test(host);
    if (!isCatalog && !isSmartstore)
      return {
        ok: true,
        warning:
          '카탈로그(/catalog/...) 또는 스마트스토어/브랜드 URL이 아닐 수 있어 파싱이 실패할 수 있습니다.',
      };
    return { ok: true };
  }

  if (channel === 'danawa') {
    if (!host.endsWith('danawa.com'))
      return { ok: false, error: '다나와 도메인(danawa.com)이 아닙니다.' };
    if (!u.searchParams.get('pcode'))
      return { ok: false, error: '다나와 상품 URL에 pcode 쿼리가 필요합니다.' };
    return { ok: true };
  }

  return { ok: true };
}

// 채널별로 "동일 상품 페이지"로 해석되는 최소 파라미터만 남겨
// DB·중복검사 키를 안정화한다. 검색·트래킹 컨텍스트는 모두 제거.
function normalizeUrl(channel: 'coupang' | 'naver' | 'danawa', raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  const host = u.hostname.toLowerCase();

  if (channel === 'danawa') {
    if (!host.endsWith('danawa.com')) return trimmed;
    const pcode = u.searchParams.get('pcode');
    if (!pcode) return trimmed;
    return `${u.origin}${u.pathname}?pcode=${pcode}`;
  }

  if (channel === 'coupang') {
    if (!host.endsWith('coupang.com')) return trimmed;
    // itemId/vendorItemId는 옵션·판매자 단위를 결정하므로 보존
    const keep = ['itemId', 'vendorItemId'];
    const params = new URLSearchParams();
    for (const k of keep) {
      const v = u.searchParams.get(k);
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    return `${u.origin}${u.pathname}${qs ? `?${qs}` : ''}`;
  }

  if (channel === 'naver') {
    if (!host.endsWith('naver.com')) return trimmed;
    // 카탈로그/스마트스토어 모두 path가 식별자, 쿼리는 전부 검색·추적 컨텍스트
    return `${u.origin}${u.pathname}`;
  }

  return trimmed;
}

export default function ProductForm({ initialData, onSubmit, onCancel }: ProductFormProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [sabangnetCode, setSabangnetCode] = useState(initialData?.sabangnet_code || '');
  const [coupangUrl, setCoupangUrl] = useState(initialData?.coupang_url || '');
  const [naverUrl, setNaverUrl] = useState(initialData?.naver_url || '');
  const [danawaUrl, setDanawaUrl] = useState(initialData?.danawa_url || '');
  const [loading, setLoading] = useState(false);

  const coupangCheck = validateUrl('coupang', coupangUrl);
  const naverCheck = validateUrl('naver', naverUrl);
  const danawaCheck = validateUrl('danawa', danawaUrl);
  const hasAnyError = !coupangCheck.ok || !naverCheck.ok || !danawaCheck.ok;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (hasAnyError) {
      window.alert('URL 형식 오류가 있는 채널이 있습니다. 빨간색 메시지를 확인하세요.');
      return;
    }

    setLoading(true);
    try {
      const payload: CreateProductInput = {
        name: name.trim(),
        sabangnet_code: sabangnetCode.trim() || null,
        coupang_url: normalizeUrl('coupang', coupangUrl) || null,
        naver_url: normalizeUrl('naver', naverUrl) || null,
        danawa_url: normalizeUrl('danawa', danawaUrl) || null,
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
      <UrlField
        color="#E44232"
        label="쿠팡 URL"
        value={coupangUrl}
        check={coupangCheck}
        onChange={setCoupangUrl}
        onBlur={() => setCoupangUrl(normalizeUrl('coupang', coupangUrl))}
        placeholder="https://www.coupang.com/..."
      />
      <UrlField
        color="#03C75A"
        label="네이버 URL"
        value={naverUrl}
        check={naverCheck}
        onChange={setNaverUrl}
        onBlur={() => setNaverUrl(normalizeUrl('naver', naverUrl))}
        placeholder="https://search.shopping.naver.com/..."
      />
      <UrlField
        color="#0068B7"
        label="다나와 URL"
        value={danawaUrl}
        check={danawaCheck}
        onChange={setDanawaUrl}
        onBlur={() => setDanawaUrl(normalizeUrl('danawa', danawaUrl))}
        placeholder="https://prod.danawa.com/..."
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || hasAnyError}
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

interface UrlFieldProps {
  color: string;
  label: string;
  value: string;
  check: UrlValidation;
  placeholder: string;
  onChange: (next: string) => void;
  onBlur: () => void;
}

function UrlField({
  color,
  label,
  value,
  check,
  placeholder,
  onChange,
  onBlur,
}: UrlFieldProps) {
  const borderClass = !check.ok
    ? 'border-red-400 focus:ring-red-500'
    : check.warning
      ? 'border-yellow-400 focus:ring-yellow-500'
      : 'border-gray-300 focus:ring-blue-500';
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        <span
          className="inline-block w-2 h-2 rounded-full mr-1.5"
          style={{ backgroundColor: color }}
        />
        {label}
      </label>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 text-gray-900 ${borderClass}`}
        placeholder={placeholder}
      />
      {!check.ok && check.error && (
        <p className="mt-1 text-xs text-red-600">⛔ {check.error}</p>
      )}
      {check.ok && check.warning && (
        <p className="mt-1 text-xs text-yellow-700">⚠ {check.warning}</p>
      )}
    </div>
  );
}
