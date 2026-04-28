'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Channel } from '@/types/database';

interface ErrorGroupRow {
  product_id: string;
  product_name: string;
  brand_name: string | null;
  channel: Channel;
  consecutive_failures: number;
  last_failure_at: string;
  last_failure_message: string;
  last_success_at: string | null;
}

const CHANNEL_LABELS: Record<Channel, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  danawa: '다나와',
};

const CHANNEL_DOTS: Record<Channel, string> = {
  coupang: '#E44232',
  naver: '#03C75A',
  danawa: '#0068B7',
};

function formatRelative(iso: string | null): string {
  if (!iso) return '없음';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '없음';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / (60 * 24))}일 전`;
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ErrorsPage() {
  const [rows, setRows] = useState<ErrorGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<Channel | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/errors?group_by=product_channel');
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || '에러 로그를 불러오지 못했습니다.');
        }
        const data: ErrorGroupRow[] = await res.json();
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : '알 수 없는 오류');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = rows.filter((r) => {
    if (channelFilter !== 'all' && r.channel !== channelFilter) return false;
    return true;
  });

  const counts = {
    all: rows.length,
    coupang: rows.filter((r) => r.channel === 'coupang').length,
    naver: rows.filter((r) => r.channel === 'naver').length,
    danawa: rows.filter((r) => r.channel === 'danawa').length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">수집 에러 로그</h1>
          <p className="text-xs text-gray-500 mt-1">
            최근 14일 기준 · 상품 × 채널 그룹 · 연속 실패 많은 순
          </p>
        </div>
        <div className="flex gap-2">
          <FilterChip
            label="전체"
            count={counts.all}
            active={channelFilter === 'all'}
            onClick={() => setChannelFilter('all')}
          />
          {(['coupang', 'naver', 'danawa'] as Channel[]).map((ch) => (
            <FilterChip
              key={ch}
              label={CHANNEL_LABELS[ch]}
              count={counts[ch]}
              active={channelFilter === ch}
              onClick={() => setChannelFilter(ch)}
              dotColor={CHANNEL_DOTS[ch]}
            />
          ))}
        </div>
      </div>

      {loading && <div className="text-center py-12 text-gray-500">로딩 중...</div>}

      {fetchError && (
        <div className="text-center py-12 text-red-500">오류: {fetchError}</div>
      )}

      {!loading && !fetchError && filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400">수집 에러가 없습니다.</div>
      )}

      {!loading && !fetchError && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((r) => (
            <ErrorGroupCard key={`${r.product_id}:${r.channel}`} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

interface ErrorGroupCardProps {
  row: ErrorGroupRow;
}

function ErrorGroupCard({ row }: ErrorGroupCardProps) {
  const severe = row.consecutive_failures >= 3;
  return (
    <div
      className={`rounded-lg border p-4 bg-white ${
        severe ? 'border-red-300 shadow-sm' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          {row.brand_name && (
            <div className="text-[10px] font-semibold text-purple-700 mb-0.5">
              {row.brand_name}
            </div>
          )}
          <Link
            href={`/products/${row.product_id}`}
            className="font-medium text-gray-900 hover:text-blue-600 hover:underline text-sm leading-tight break-keep"
          >
            {row.product_name}
          </Link>
        </div>
        <span
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ color: CHANNEL_DOTS[row.channel] }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: CHANNEL_DOTS[row.channel] }}
          />
          {CHANNEL_LABELS[row.channel]}
        </span>
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <span
          className={`text-2xl font-bold tabular-nums ${
            severe ? 'text-red-600' : 'text-gray-700'
          }`}
        >
          {row.consecutive_failures}
        </span>
        <span className="text-xs text-gray-500">연속 실패</span>
        {severe && (
          <span className="text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 ml-auto">
            ⚠ 점검 필요
          </span>
        )}
      </div>

      <dl className="text-xs space-y-1 text-gray-600 border-t border-gray-100 pt-2">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">마지막 실패</dt>
          <dd
            className="text-gray-700 tabular-nums"
            title={formatAbsolute(row.last_failure_at)}
          >
            {formatRelative(row.last_failure_at)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">마지막 성공</dt>
          <dd
            className={`tabular-nums ${row.last_success_at ? 'text-gray-700' : 'text-red-500'}`}
            title={row.last_success_at ? formatAbsolute(row.last_success_at) : ''}
          >
            {formatRelative(row.last_success_at)}
          </dd>
        </div>
      </dl>

      <div className="mt-2 text-[11px] text-red-600 font-mono break-words bg-red-50 rounded px-2 py-1">
        {row.last_failure_message}
      </div>

      <div className="mt-2 flex justify-end">
        <Link
          href={`/products/${row.product_id}`}
          className="text-[11px] text-blue-600 hover:underline"
        >
          상품 상세 보기 →
        </Link>
      </div>
    </div>
  );
}

interface FilterChipProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  dotColor?: string;
}

function FilterChip({ label, count, active, onClick, dotColor }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-gray-900 text-white border-gray-900'
          : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
      }`}
    >
      {dotColor && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full mr-1"
          style={{ backgroundColor: dotColor }}
        />
      )}
      {label}
      <span className={`ml-1.5 ${active ? 'text-gray-300' : 'text-gray-500'}`}>
        {count}
      </span>
    </button>
  );
}
