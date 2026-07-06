'use client';

import { useState, useMemo, useEffect } from 'react';
import { useToast } from '@/components/Toast';
import { KpiCardSkeleton, Skeleton } from '@/components/Skeleton';
import Sparkline from '@/components/Sparkline';
import { useBrightdataUsage, type Bucket } from '@/hooks/useBrightdataUsage';

interface BalanceResponse {
  balance: number | null;
  pendingBalance: number | null;
  pendingCosts: number | null;
  currency: string;
  fetchedAt: string;
}

interface BalanceErrorResponse {
  code?: string;
  permissionUrl?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('ko-KR');
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export default function BrightDataPage() {
  const toast = useToast();
  const { usage, sync, loading, error, refetch } = useBrightdataUsage();
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceErrorMeta, setBalanceErrorMeta] = useState<BalanceErrorResponse | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const projected = usage?.projected ?? null;
  const official = usage?.official ?? null;

  // 월 예상 비용은 공식 과금 기준(누적 official 비용을 월 경과율로 나눠 월말 추정)을 우선하고,
  // 공식 값이 없으면 로컬 성공수 기반 projected로 폴백한다.
  const officialMonthlyCostUsd = useMemo(() => {
    if (official && projected && projected.elapsedMonthRatio > 0) {
      return official.estimatedCostUsd / projected.elapsedMonthRatio;
    }
    return projected?.estimatedCostUsd ?? null;
  }, [official, projected]);

  const officialProjectedRequests = useMemo(() => {
    if (official && projected && projected.elapsedMonthRatio > 0) {
      return Math.round(official.totalRequests / projected.elapsedMonthRatio);
    }
    return projected?.total ?? null;
  }, [official, projected]);

  const balanceRunwayMonths = useMemo(() => {
    if (!balance || typeof balance.balance !== 'number') return null;
    if (!officialMonthlyCostUsd || officialMonthlyCostUsd <= 0) return null;
    return balance.balance / officialMonthlyCostUsd;
  }, [balance, officialMonthlyCostUsd]);

  const loadBalance = async () => {
    setBalanceLoading(true);
    setBalanceError(null);
    setBalanceErrorMeta(null);
    try {
      const res = await fetch('/api/brightdata/balance', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) {
        setBalanceError(body.error ?? `잔액 조회 실패 (${res.status})`);
        setBalanceErrorMeta({
          code: body.code,
          permissionUrl: body.permissionUrl,
        });
        return;
      }
      setBalance(body);
    } catch (err) {
      setBalanceError(err instanceof Error ? err.message : '잔액 조회 실패');
    } finally {
      setBalanceLoading(false);
    }
  };

  // 잔액은 usage/sync를 담당하는 useBrightdataUsage와 별개로 마운트 시 1회 조회
  useEffect(() => {
    loadBalance();
  }, []);

  const runSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/brightdata/sync', { method: 'POST', body: '{}' });
      const body = await res.json();
      if (!res.ok) {
        toast.error(`동기화 실패: ${body.error}`);
        return;
      }
      toast.success('Bright Data 공식 통계 동기화 완료');
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '동기화 실패');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Bright Data 사용량</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
        </div>
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-6 space-y-2">
          <Skeleton className="h-4 w-32 mb-3" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      </div>
    );
  }
  if (error) return <div className="text-red-600">{error}</div>;
  if (!usage) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Bright Data 사용량</h1>

      {/* 계정 잔액 */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="text-sm text-gray-500 mb-2">계정 잔액 (USD)</div>
            {balanceError ? (
              <div className="text-sm text-amber-700">
                <div>{balanceError}</div>
                {balanceErrorMeta?.code === 'permission_denied' &&
                  balanceErrorMeta.permissionUrl && (
                  <a
                    href={balanceErrorMeta.permissionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block mt-1 text-blue-600 hover:text-blue-700 underline"
                  >
                    Bright Data 토큰 권한 설정 열기
                  </a>
                )}
                <div className="mt-1 text-xs text-gray-500">
                  잔액만 조회하지 못했습니다. 사용량과 예상 비용은 로컬 수집 로그 기준으로 계속 계산됩니다.
                </div>
              </div>
            ) : balance === null ? (
              <div className="text-sm text-gray-500">조회 중...</div>
            ) : (
              <div className="flex items-baseline gap-6 flex-wrap">
                <div>
                  <div className="text-3xl font-bold text-gray-900">
                    {balance.balance !== null ? formatUsd(balance.balance) : '—'}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">사용 가능</div>
                </div>
                <div>
                  <div className="text-xl font-semibold text-gray-700">
                    {balance.pendingCosts !== null ? formatUsd(balance.pendingCosts) : '—'}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">미청구 비용 (pending)</div>
                </div>
                {balanceRunwayMonths !== null && officialMonthlyCostUsd !== null && (
                  <div>
                    <div
                      className={`text-xl font-semibold ${
                        balanceRunwayMonths < 1 ? 'text-red-600' : 'text-gray-700'
                      }`}
                    >
                      {balanceRunwayMonths.toFixed(1)}개월
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      현재 페이스 기준 (월 {formatUsd(officialMonthlyCostUsd)})
                    </div>
                  </div>
                )}
                <div className="text-xs text-gray-400 self-end">
                  {balance.fetchedAt.slice(0, 19).replace('T', ' ')} 조회
                </div>
              </div>
            )}
          </div>
          <button
            onClick={loadBalance}
            disabled={balanceLoading}
            className="px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            {balanceLoading ? '조회 중...' : '새로고침'}
          </button>
        </div>
      </div>

      {/* 오늘/이번 달/예상 KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <BucketCard title="오늘 (KST)" bucket={usage.today} costLabel="로컬 관측 · 참고용" />

        {/* 이번 달 비용 — 공식 과금 기준 우선, 없으면 로컬 추정 */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="text-sm text-gray-500 mb-2">이번 달</div>
          <div className="text-3xl font-bold text-gray-900 mb-1">
            {formatNumber(official ? official.totalRequests : usage.month.total)}
          </div>
          <div className="text-lg font-semibold text-blue-600 mb-3">
            {formatUsd(official ? official.estimatedCostUsd : usage.month.estimatedCostUsd)}
            <span className="text-xs text-gray-400 ml-1">
              {official ? '공식 과금 기준' : '로컬 추정'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-gray-500">
                {official ? '공식 과금 요청' : '로컬 성공'}
              </div>
              <div className="font-semibold text-gray-700">
                {formatNumber(official ? official.totalRequests : usage.month.success)}
              </div>
            </div>
            <div>
              <div className="text-gray-500">로컬 관측 호출</div>
              <div className="font-semibold text-gray-700">
                {formatNumber(usage.month.total)}
              </div>
            </div>
          </div>
        </div>

        {projected && (
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="text-sm text-gray-500 mb-2">월말 예상</div>
            <div className="text-3xl font-bold text-gray-900 mb-1">
              {formatNumber(officialProjectedRequests ?? projected.total)}
            </div>
            <div className="text-lg font-semibold text-blue-600 mb-3">
              {formatUsd(officialMonthlyCostUsd ?? projected.estimatedCostUsd)}
              <span className="text-xs text-gray-400 ml-1">
                {official ? '예상 비용 (공식 기준)' : '예상 비용 (로컬 추정)'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-gray-500">예상 대역폭</div>
                <div className="font-semibold text-gray-700">
                  {formatBytes(projected.bytes)}
                </div>
              </div>
              <div>
                <div className="text-gray-500">월 경과율</div>
                <div className="font-semibold text-gray-700">
                  {(projected.elapsedMonthRatio * 100).toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-500 h-1.5"
                style={{
                  width: `${Math.round(projected.elapsedMonthRatio * 100)}%`,
                }}
              />
            </div>
            <div className="mt-2 text-xs text-gray-500">
              {official
                ? `공식 과금 요청 ${formatNumber(officialProjectedRequests ?? 0)}건 기준`
                : `성공 요청 ${formatNumber(projected.success)}건 기준 (로컬 추정)`}
            </div>
          </div>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6 text-sm text-blue-900">
        비용은 Bright Data 공식 과금 요청 수(/domains/req)를 기준으로 계산합니다
        {official ? '' : ' (공식 API 조회 실패 시 로컬 추정으로 폴백)'}. 로컬 수집 로그는
        재시도·무효응답(200 OK지만 차단·빈 응답)까지 포함해 실제 과금보다 많을 수 있어 참고용
        관측치입니다. 단가는 {formatUsd(usage.pricing.cpmUsd)}/1K 요청
        {usage.pricing.includedRequests > 0
          ? `, 포함 요청 ${formatNumber(usage.pricing.includedRequests)}건`
          : ''}
        {usage.pricing.monthlyCommitmentUsd > 0
          ? `, 월 기본료 ${formatUsd(usage.pricing.monthlyCommitmentUsd)}`
          : ''}
        입니다.
      </div>

      {/* 채널별 분포 */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        {official ? (
          <>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              채널별 (이번 달 · 공식 과금 기준)
            </h2>
            {official.byChannel.length === 0 ? (
              <div className="text-sm text-gray-500">데이터 없음</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-gray-500 text-left">
                  <tr>
                    <th className="py-2">채널</th>
                    <th className="py-2 text-right">공식 요청수</th>
                    <th className="py-2 text-right">공식 비용</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {official.byChannel.map((c) => (
                    <tr key={c.channel}>
                      <td className="py-2 font-medium text-gray-900">{c.channel}</td>
                      <td className="py-2 text-right text-gray-700">
                        {formatNumber(c.requests)}
                      </td>
                      <td className="py-2 text-right text-blue-700 font-medium">
                        {formatUsd(c.estimatedCostUsd)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-200 font-semibold">
                    <td className="py-2 text-gray-900">합계</td>
                    <td className="py-2 text-right text-gray-900">
                      {formatNumber(official.totalRequests)}
                    </td>
                    <td className="py-2 text-right text-blue-700">
                      {formatUsd(official.estimatedCostUsd)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              채널별 (이번 달 · 로컬 관측)
            </h2>
            {usage.byChannel.length === 0 ? (
              <div className="text-sm text-gray-500">데이터 없음</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-gray-500 text-left">
                  <tr>
                    <th className="py-2">채널</th>
                    <th className="py-2 text-right">호출</th>
                    <th className="py-2 text-right">성공</th>
                    <th className="py-2 text-right">예상 비용</th>
                    <th className="py-2 text-right">실패율</th>
                    <th className="py-2 text-right">평균 소요</th>
                    <th className="py-2 text-right">대역폭</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {usage.byChannel.map((c) => (
                    <tr key={c.channel}>
                      <td className="py-2 font-medium text-gray-900">{c.channel}</td>
                      <td className="py-2 text-right text-gray-700">{formatNumber(c.total)}</td>
                      <td className="py-2 text-right text-gray-700">{formatNumber(c.success)}</td>
                      <td className="py-2 text-right text-blue-700 font-medium">
                        {formatUsd(c.estimatedCostUsd)}
                      </td>
                      <td className="py-2 text-right text-gray-700">
                        {c.total === 0 ? '-' : `${((c.failed / c.total) * 100).toFixed(1)}%`}
                      </td>
                      <td className="py-2 text-right text-gray-700">{c.avgDurationMs} ms</td>
                      <td className="py-2 text-right text-gray-700">{formatBytes(c.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* 일별 추이 (로컬 관측 · 재시도·무효응답 포함, 참고용) */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">일별 추이 (최근 14일)</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              로컬 관측 · 재시도·무효응답 포함, 참고용
            </p>
          </div>
          {usage.daily.length >= 2 && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>호출 수</span>
              <Sparkline values={usage.daily.map((d) => d.total)} width={140} height={28} />
            </div>
          )}
        </div>
        {usage.daily.length === 0 ? (
          <div className="text-sm text-gray-500">데이터 없음</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-500 text-left">
              <tr>
                <th className="py-2">날짜</th>
                <th className="py-2 text-right">호출</th>
                <th className="py-2 text-right">실패</th>
                <th className="py-2 text-right">예상 비용</th>
                <th className="py-2 text-right">평균 소요</th>
                <th className="py-2 text-right">대역폭</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {usage.daily.map((d) => (
                <tr key={d.date}>
                  <td className="py-2 text-gray-700">{d.date}</td>
                  <td className="py-2 text-right text-gray-700">{formatNumber(d.total)}</td>
                  <td className="py-2 text-right text-gray-700">{formatNumber(d.failed)}</td>
                  <td className="py-2 text-right text-blue-700 font-medium">
                    {formatUsd(d.estimatedCostUsd)}
                  </td>
                  <td className="py-2 text-right text-gray-700">{d.avgDurationMs} ms</td>
                  <td className="py-2 text-right text-gray-700">{formatBytes(d.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 공식 통계 동기화 (A) */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">공식 통계 비교 (Bright Data API)</h2>
          <button
            onClick={runSync}
            disabled={syncing}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? '동기화 중...' : '지금 동기화'}
          </button>
        </div>

        {!sync || !sync.latest ? (
          <div className="text-sm text-gray-500">
            아직 동기화된 스냅샷이 없습니다. &ldquo;지금 동기화&rdquo; 버튼을 눌러 Bright Data 공식 통계를 가져오세요.
          </div>
        ) : (
          <div className="space-y-1 text-sm">
            <div className="text-gray-700">
              기간:{' '}
              <span className="font-semibold">
                {sync.latest.period_start} ~ {sync.latest.period_end}
              </span>{' '}
              <span className="text-gray-500">({sync.latest.fetched_at.slice(0, 19).replace('T', ' ')} 동기화)</span>
            </div>
            <div className="text-gray-700">
              공식 요청 수:{' '}
              <span className="font-semibold">
                {sync.latest.request_count !== null ? formatNumber(sync.latest.request_count) : '—'}
              </span>
              {sync.latest.request_count !== null && (
                <span className="ml-2 text-blue-600 font-semibold">
                  ({formatUsd((sync.latest.request_count / 1000) * usage.pricing.cpmUsd)})
                </span>
              )}
            </div>
            <div className="text-gray-700">
              로컬 카운트:{' '}
              <span className="font-semibold">{formatNumber(sync.localCount ?? 0)}</span>
              <span className="ml-2 text-gray-500">
                성공 {formatNumber(sync.localSuccessCount ?? 0)}건
              </span>
              <span className="ml-2 text-blue-600 font-semibold">
                ({formatUsd(((sync.localSuccessCount ?? 0) / 1000) * usage.pricing.cpmUsd)})
              </span>
            </div>
            {sync.drift !== null && (
              <div className={sync.drift !== 0 ? 'text-amber-700' : 'text-green-700'}>
                Drift: {sync.drift > 0 ? '+' : ''}
                {formatNumber(sync.drift)}{' '}
                <span className="text-xs text-gray-500">
                  (공식 - 로컬, 0에 가까울수록 정확)
                </span>
              </div>
            )}
            {sync.latest.bandwidth_bytes !== null && (
              <div className="text-gray-700">
                공식 대역폭: <span className="font-semibold">{formatBytes(sync.latest.bandwidth_bytes)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BucketCard({
  title,
  bucket,
  cost,
  costLabel,
}: {
  title: string;
  bucket: Bucket;
  cost?: number;
  costLabel?: string;
}) {
  const failRate = bucket.total === 0 ? 0 : (bucket.failed / bucket.total) * 100;
  const displayCost = cost ?? bucket.estimatedCostUsd;
  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <div className="text-sm text-gray-500 mb-2">{title}</div>
      <div className="text-3xl font-bold text-gray-900 mb-1">{formatNumber(bucket.total)}</div>
      <div className="text-lg font-semibold text-blue-600 mb-3">
        {formatUsd(displayCost)}
        <span className="text-xs text-gray-400 ml-1">{costLabel ?? '성공 요청 기준'}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-gray-500">성공</div>
          <div className="font-semibold text-green-700">{formatNumber(bucket.success)}</div>
        </div>
        <div>
          <div className="text-gray-500">실패율</div>
          <div className={`font-semibold ${failRate > 5 ? 'text-red-600' : 'text-gray-700'}`}>
            {failRate.toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-gray-500">평균 소요</div>
          <div className="font-semibold text-gray-700">{bucket.avgDurationMs} ms</div>
        </div>
        <div>
          <div className="text-gray-500">대역폭</div>
          <div className="font-semibold text-gray-700">{formatBytes(bucket.bytes)}</div>
        </div>
      </div>
    </div>
  );
}
