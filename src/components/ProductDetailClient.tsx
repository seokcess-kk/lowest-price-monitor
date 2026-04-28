'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { usePriceHistory } from '@/hooks/usePriceHistory';
import PriceChart from '@/components/PriceChart';
import PriceChangeIndicator from '@/components/PriceChangeIndicator';
import { ChartSkeleton } from '@/components/Skeleton';
import type { Channel, PriceLog, Product } from '@/types/database';

interface ChannelErrorSummary {
  channel: Channel;
  consecutive_failures: number;
  last_failure_at: string;
  last_success_at: string | null;
}

function formatRelativeShort(iso: string | null): string {
  if (!iso) return '없음';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '없음';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / (60 * 24))}일 전`;
}

type Period = '7d' | '30d' | '90d' | 'all';
type ChartMode = 'combined' | 'split';
type Aggregation = 'daily' | 'raw';

const PERIOD_LABELS: Record<Period, string> = {
  '7d': '7일',
  '30d': '30일',
  '90d': '90일',
  all: '전체',
};

const CHANNELS: Channel[] = ['coupang', 'naver', 'danawa'];

const CHANNEL_LABELS: Record<Channel, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  danawa: '다나와',
};

const CHANNEL_COLORS: Record<Channel, string> = {
  coupang: '#E44232',
  naver: '#03C75A',
  danawa: '#0068B7',
};

const PAGE_SIZE = 25;

function getStartDate(period: Period): string | undefined {
  if (period === 'all') return undefined;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

interface Props {
  productId: string;
  initialProduct: Product;
  initialPeriod: Period;
  initialHistory: PriceLog[];
}

export default function ProductDetailClient({
  productId,
  initialProduct,
  initialPeriod,
  initialHistory,
}: Props) {
  const product = initialProduct;
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [chartMode, setChartMode] = useState<ChartMode>('combined');
  const [aggregation, setAggregation] = useState<Aggregation>('daily');
  const [chartChannels, setChartChannels] = useState<Set<Channel>>(
    new Set(CHANNELS)
  );
  const [logChannelFilter, setLogChannelFilter] = useState<Channel | 'all'>('all');
  const [logChangedOnly, setLogChangedOnly] = useState(false);
  const [logPage, setLogPage] = useState(1);

  const startDate = useMemo(() => getStartDate(period), [period]);

  const { data, loading, error } = usePriceHistory(
    productId,
    { startDate },
    initialHistory
  );

  // 채널별 마지막 실패 정보 — 헤더의 수집 상태 라인에 표시
  const [channelErrors, setChannelErrors] = useState<ChannelErrorSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/errors?group_by=product_channel&product_id=${productId}`)
      .then((r) => r.json())
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return;
        setChannelErrors(rows as ChannelErrorSummary[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [productId]);

  // 채널별 최신/이전 가격 (헤더용)
  const channelLatest = useMemo(() => {
    const map: Partial<Record<Channel, { latest: PriceLog; previous?: PriceLog }>> = {};
    for (const ch of CHANNELS) {
      const channelLogs = data
        .filter((l) => l.channel === ch)
        .sort(
          (a, b) =>
            new Date(b.collected_at).getTime() -
            new Date(a.collected_at).getTime()
        );
      if (channelLogs.length === 0) continue;
      map[ch] = { latest: channelLogs[0], previous: channelLogs[1] };
    }
    return map;
  }, [data]);

  // 현재 최저가 (헤더 메인)
  const overall = useMemo(() => {
    let cheapest: { channel: Channel; latest: PriceLog; previous?: PriceLog } | null =
      null;
    for (const ch of CHANNELS) {
      const entry = channelLatest[ch];
      if (!entry) continue;
      if (!cheapest || entry.latest.price < cheapest.latest.price) {
        cheapest = { channel: ch, ...entry };
      }
    }
    return cheapest;
  }, [channelLatest]);

  // "최근 N일 최저가 갱신" 배지 — 현재 overall 가격이 기간 내 최소면 표시
  const lowestRecord = useMemo(() => {
    if (!overall) return null;
    if (data.length === 0) return null;
    const min = data.reduce((m, l) => (l.price < m.price ? l : m));
    if (overall.latest.price <= min.price) {
      const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : null;
      return { days };
    }
    return null;
  }, [data, overall, period]);

  // 채널별 마지막 성공 시각 — initialHistory 기준
  const lastSuccessByChannel = useMemo(() => {
    const map: Partial<Record<Channel, string>> = {};
    for (const ch of CHANNELS) {
      const entry = channelLatest[ch];
      if (entry) map[ch] = entry.latest.collected_at;
    }
    return map;
  }, [channelLatest]);

  // 채널별 마지막 실패 — channelErrors index
  const errorByChannel = useMemo(() => {
    const map: Partial<Record<Channel, ChannelErrorSummary>> = {};
    for (const e of channelErrors) {
      map[e.channel] = e;
    }
    return map;
  }, [channelErrors]);

  // 기간 내 KPI 통계
  const stats = useMemo(() => {
    if (data.length === 0) {
      return {
        min: null as { price: number; channel: Channel; date: string } | null,
        max: null as { price: number; channel: Channel; date: string } | null,
        avg: null as number | null,
        startDelta: null as { abs: number; pct: number } | null,
        count: 0,
      };
    }
    let min = data[0];
    let max = data[0];
    let sum = 0;
    for (const log of data) {
      if (log.price < min.price) min = log;
      if (log.price > max.price) max = log;
      sum += log.price;
    }
    const avg = sum / data.length;

    // 시작 대비 변동률 — 최저가 채널 기준
    let startDelta: { abs: number; pct: number } | null = null;
    if (overall) {
      const sameChannel = data
        .filter((l) => l.channel === overall.channel)
        .sort(
          (a, b) =>
            new Date(a.collected_at).getTime() -
            new Date(b.collected_at).getTime()
        );
      if (sameChannel.length >= 2) {
        const first = sameChannel[0].price;
        const last = sameChannel[sameChannel.length - 1].price;
        if (first > 0) {
          startDelta = { abs: last - first, pct: ((last - first) / first) * 100 };
        }
      }
    }

    return {
      min: {
        price: min.price,
        channel: min.channel,
        date: min.collected_at.split('T')[0],
      },
      max: {
        price: max.price,
        channel: max.channel,
        date: max.collected_at.split('T')[0],
      },
      avg,
      startDelta,
      count: data.length,
    };
  }, [data, overall]);

  // 로그 필터 적용
  const filteredLogs = useMemo(() => {
    let arr = [...data].sort(
      (a, b) =>
        new Date(b.collected_at).getTime() - new Date(a.collected_at).getTime()
    );

    if (logChannelFilter !== 'all') {
      arr = arr.filter((l) => l.channel === logChannelFilter);
    }

    if (logChangedOnly) {
      // 같은 채널 직전 값과 다른 행만 (최신 → 과거 순회 시 다음 값과 비교)
      const result: PriceLog[] = [];
      const lastSeen = new Map<Channel, number>();
      // 과거 → 최신 순으로 순회하면서 직전 값과 비교
      const chronological = [...arr].reverse();
      for (const log of chronological) {
        const prev = lastSeen.get(log.channel);
        if (prev === undefined || prev !== log.price) {
          result.push(log);
        }
        lastSeen.set(log.channel, log.price);
      }
      // 다시 최신 → 과거로
      arr = result.reverse();
    }

    return arr;
  }, [data, logChannelFilter, logChangedOnly]);

  // 페이지네이션
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const safePage = Math.min(logPage, totalPages);
  const pagedLogs = filteredLogs.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const toggleChartChannel = (ch: Channel) => {
    setChartChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) {
        if (next.size === 1) return prev; // 최소 1개 유지
        next.delete(ch);
      } else {
        next.add(ch);
      }
      return next;
    });
  };

  const onPeriodChange = (p: Period) => {
    setPeriod(p);
    setLogPage(1);
  };

  return (
    <div>
      {/* === A. 헤더 === */}
      <div className="mb-4 sm:mb-6">
        <Link
          href="/"
          className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1 mb-2"
        >
          ← 대시보드로
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            {product.brand_name && (
              <span className="text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded px-2 py-0.5 self-start">
                {product.brand_name}
              </span>
            )}
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 break-keep">
              {product.name}
            </h1>
          </div>
          <Link
            href="/products/manage"
            className="min-h-9 inline-flex items-center px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
          >
            ✏ 상품 관리
          </Link>
        </div>

        {/* 현재 최저가 + 채널별 인라인 가격 */}
        <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
          {overall ? (
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
              <div>
                <div className="text-xs text-gray-500 mb-1">현재 최저가</div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums">
                    {overall.latest.price.toLocaleString('ko-KR')}원
                  </span>
                  {overall.previous && (
                    <PriceChangeIndicator
                      change={overall.latest.price - overall.previous.price}
                      percent={
                        overall.previous.price > 0
                          ? ((overall.latest.price - overall.previous.price) /
                              overall.previous.price) *
                            100
                          : null
                      }
                      size="md"
                    />
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded text-white inline-block"
                    style={{ backgroundColor: CHANNEL_COLORS[overall.channel] }}
                  >
                    👑 {CHANNEL_LABELS[overall.channel]}
                    {overall.latest.store_name &&
                      ` · ${overall.latest.store_name}`}
                  </span>
                  {lowestRecord && (
                    <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                      🏆 {lowestRecord.days ? `${lowestRecord.days}일` : '전체 기간'} 최저가 갱신
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 w-full lg:w-auto lg:flex lg:flex-wrap">
                {CHANNELS.map((ch) => {
                  const entry = channelLatest[ch];
                  const url = product[`${ch}_url` as const];
                  const isCheapest = overall.channel === ch;
                  const lastSuccess = lastSuccessByChannel[ch] ?? null;
                  const errInfo = errorByChannel[ch];
                  const hasOpenError =
                    !!errInfo && errInfo.consecutive_failures > 0;
                  const inner = (
                    <div
                      className={`px-2 sm:px-3 py-2 rounded border lg:min-w-[140px] h-full ${
                        hasOpenError
                          ? 'border-red-300 bg-red-50/40'
                          : isCheapest
                            ? 'border-yellow-400 bg-yellow-50/40'
                            : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div
                        className="text-xs font-semibold flex items-center justify-between gap-1"
                        style={{ color: CHANNEL_COLORS[ch] }}
                      >
                        <span className="truncate">
                          ● {CHANNEL_LABELS[ch]}
                          {isCheapest && ' 👑'}
                        </span>
                        {url && <span className="text-gray-400 shrink-0">↗</span>}
                      </div>
                      {entry ? (
                        <div className="text-sm sm:text-base font-bold text-gray-900 tabular-nums mt-0.5">
                          {entry.latest.price.toLocaleString('ko-KR')}원
                        </div>
                      ) : (
                        <div className="text-xs sm:text-sm text-gray-400 mt-0.5">없음</div>
                      )}
                      <div className="mt-1 text-[10px] leading-tight space-y-0.5">
                        <div className="text-gray-500">
                          ✓ {formatRelativeShort(lastSuccess)}
                        </div>
                        {hasOpenError && (
                          <div className="text-red-600 font-medium">
                            ⚠ {errInfo.consecutive_failures}회 실패 ·{' '}
                            {formatRelativeShort(errInfo.last_failure_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                  return url ? (
                    <a
                      key={ch}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block transition-colors hover:opacity-80"
                      title={`${CHANNEL_LABELS[ch]} 페이지로 이동`}
                    >
                      {inner}
                    </a>
                  ) : (
                    <div key={ch}>{inner}</div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-gray-400 text-sm">
              {loading ? '로딩 중...' : '수집된 가격이 없습니다.'}
            </div>
          )}
        </div>
      </div>

      {error && <div className="text-center py-12 text-red-500">오류: {error}</div>}

      {!error && (
        <>
          {/* === B. KPI 카드 === */}
          {data.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-4 sm:mb-6">
              <KpiCard
                label={`기간 내 최저가`}
                value={
                  stats.min ? `${stats.min.price.toLocaleString('ko-KR')}원` : '-'
                }
                sub={
                  stats.min
                    ? `${CHANNEL_LABELS[stats.min.channel]} · ${stats.min.date}`
                    : undefined
                }
                tone="lowest"
              />
              <KpiCard
                label="기간 내 최고가"
                value={
                  stats.max ? `${stats.max.price.toLocaleString('ko-KR')}원` : '-'
                }
                sub={
                  stats.max
                    ? `${CHANNEL_LABELS[stats.max.channel]} · ${stats.max.date}`
                    : undefined
                }
                tone="highest"
              />
              <KpiCard
                label="평균 가격"
                value={
                  stats.avg !== null
                    ? `${Math.round(stats.avg).toLocaleString('ko-KR')}원`
                    : '-'
                }
              />
              <KpiCard
                label="시작 대비 변동"
                value={
                  stats.startDelta
                    ? `${stats.startDelta.pct > 0 ? '+' : ''}${stats.startDelta.pct.toFixed(1)}%`
                    : '-'
                }
                sub={
                  stats.startDelta
                    ? `${stats.startDelta.abs > 0 ? '+' : ''}${stats.startDelta.abs.toLocaleString('ko-KR')}원`
                    : undefined
                }
                tone={
                  stats.startDelta
                    ? stats.startDelta.pct < 0
                      ? 'down'
                      : stats.startDelta.pct > 0
                        ? 'up'
                        : 'neutral'
                    : 'neutral'
                }
              />
              <KpiCard label="수집 횟수" value={`${stats.count}건`} />
            </div>
          )}

          {/* === C. 차트 카드 === */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
            <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-800">가격 추이</h2>
              <div className="flex flex-wrap items-center gap-2">
                {/* 기간 토글 */}
                <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-xs">
                  {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => onPeriodChange(p)}
                      className={`px-3 py-1.5 ${
                        period === p
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-700 hover:bg-gray-50'
                      } ${p !== '7d' ? 'border-l border-gray-300' : ''}`}
                    >
                      {PERIOD_LABELS[p]}
                    </button>
                  ))}
                </div>
                {/* 모드 토글 */}
                <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-xs">
                  <button
                    onClick={() => setChartMode('combined')}
                    className={`px-3 py-1.5 ${
                      chartMode === 'combined'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    통합
                  </button>
                  <button
                    onClick={() => setChartMode('split')}
                    className={`px-3 py-1.5 border-l border-gray-300 ${
                      chartMode === 'split'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    분리
                  </button>
                </div>
                {/* 집계 토글 — 일별 최저 vs 모든 시점 */}
                <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-xs">
                  <button
                    onClick={() => setAggregation('daily')}
                    className={`px-3 py-1.5 ${
                      aggregation === 'daily'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                    title="같은 날 같은 채널의 최저값 1점만 표시 (이상치 영향 최소)"
                  >
                    일별 최저
                  </button>
                  <button
                    onClick={() => setAggregation('raw')}
                    className={`px-3 py-1.5 border-l border-gray-300 ${
                      aggregation === 'raw'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                    title="모든 수집 시점을 그대로 표시 (의심 데이터 검증용)"
                  >
                    전체 수집
                  </button>
                </div>
              </div>
            </div>

            {/* 채널 토글 칩 */}
            {chartMode === 'combined' && (
              <div className="px-4 pt-3 pb-1 flex flex-wrap gap-2">
                {CHANNELS.map((ch) => {
                  const active = chartChannels.has(ch);
                  return (
                    <button
                      key={ch}
                      onClick={() => toggleChartChannel(ch)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        active
                          ? 'border-transparent text-white'
                          : 'border-gray-300 text-gray-500 bg-white hover:border-gray-400'
                      }`}
                      style={
                        active
                          ? { backgroundColor: CHANNEL_COLORS[ch] }
                          : undefined
                      }
                    >
                      ● {CHANNEL_LABELS[ch]}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="p-4">
              {loading ? (
                <ChartSkeleton height={400} />
              ) : (
                <PriceChart
                  data={data}
                  visibleChannels={Array.from(chartChannels)}
                  mode={chartMode}
                  aggregation={aggregation}
                />
              )}
            </div>
          </div>

          {/* === D. 수집 로그 === */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-800">
                수집 로그
                <span className="ml-2 text-xs text-gray-500 font-normal">
                  (총 {filteredLogs.length}건)
                </span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <LogChip
                    label="전체"
                    active={logChannelFilter === 'all'}
                    onClick={() => {
                      setLogChannelFilter('all');
                      setLogPage(1);
                    }}
                  />
                  {CHANNELS.map((ch) => (
                    <LogChip
                      key={ch}
                      label={CHANNEL_LABELS[ch]}
                      color={CHANNEL_COLORS[ch]}
                      active={logChannelFilter === ch}
                      onClick={() => {
                        setLogChannelFilter(ch);
                        setLogPage(1);
                      }}
                    />
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-xs text-gray-700 ml-2">
                  <input
                    type="checkbox"
                    checked={logChangedOnly}
                    onChange={(e) => {
                      setLogChangedOnly(e.target.checked);
                      setLogPage(1);
                    }}
                  />
                  변동만 보기
                </label>
              </div>
            </div>

            {filteredLogs.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                조건에 맞는 수집 로그가 없습니다.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">
                          수집일시
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">
                          채널
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700">
                          가격
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">
                          판매처
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedLogs.map((log) => (
                        <tr
                          key={log.id}
                          className="border-b border-gray-100 hover:bg-gray-50"
                        >
                          <td className="px-4 py-1.5 text-xs text-gray-600 tabular-nums">
                            {new Date(log.collected_at).toLocaleString('ko-KR')}
                          </td>
                          <td className="px-4 py-1.5 text-xs">
                            <span
                              className="inline-block w-2 h-2 rounded-full mr-1.5"
                              style={{ backgroundColor: CHANNEL_COLORS[log.channel] }}
                            />
                            {CHANNEL_LABELS[log.channel]}
                          </td>
                          <td className="px-4 py-1.5 text-xs text-right font-semibold text-gray-900 tabular-nums">
                            {log.price.toLocaleString('ko-KR')}원
                          </td>
                          <td className="px-4 py-1.5 text-xs text-gray-500 truncate max-w-[200px]">
                            {log.store_name || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 페이지네이션 */}
                <div className="flex items-center justify-between p-3 border-t border-gray-100 text-xs text-gray-600 gap-2">
                  <span className="truncate">
                    {(safePage - 1) * PAGE_SIZE + 1}–
                    {Math.min(safePage * PAGE_SIZE, filteredLogs.length)} /{' '}
                    {filteredLogs.length}건
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setLogPage(1)}
                      disabled={safePage === 1}
                      className="hidden sm:inline-block min-h-8 px-2 py-1 border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-50"
                    >
                      «
                    </button>
                    <button
                      onClick={() => setLogPage(safePage - 1)}
                      disabled={safePage === 1}
                      className="min-h-8 px-2 py-1 border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-50"
                    >
                      ‹
                    </button>
                    <span className="px-2 sm:px-3 tabular-nums">
                      {safePage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setLogPage(safePage + 1)}
                      disabled={safePage === totalPages}
                      className="min-h-8 px-2 py-1 border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-50"
                    >
                      ›
                    </button>
                    <button
                      onClick={() => setLogPage(totalPages)}
                      disabled={safePage === totalPages}
                      className="hidden sm:inline-block min-h-8 px-2 py-1 border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-50"
                    >
                      »
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'lowest' | 'highest' | 'up' | 'down';
}

function KpiCard({ label, value, sub, tone = 'neutral' }: KpiCardProps) {
  const toneClass = {
    neutral: 'bg-white border-gray-200 text-gray-900',
    lowest: 'bg-blue-50 border-blue-200 text-blue-700',
    highest: 'bg-red-50 border-red-200 text-red-700',
    up: 'bg-red-50 border-red-200 text-red-700',
    down: 'bg-blue-50 border-blue-200 text-blue-700',
  }[tone];
  return (
    <div className={`rounded-lg border p-2.5 sm:p-3 ${toneClass}`}>
      <div className="text-[11px] sm:text-xs font-medium opacity-80">{label}</div>
      <div className="text-base sm:text-lg font-bold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[10px] sm:text-[11px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

interface LogChipProps {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}

function LogChip({ label, color, active, onClick }: LogChipProps) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded text-xs border ${
        active
          ? 'bg-gray-900 text-white border-gray-900'
          : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
      }`}
    >
      {color && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full mr-1"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
    </button>
  );
}
