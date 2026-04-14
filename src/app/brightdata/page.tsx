'use client';

import { useEffect, useState, useMemo } from 'react';
import { useToast } from '@/components/Toast';
import { KpiCardSkeleton, Skeleton } from '@/components/Skeleton';
import Sparkline from '@/components/Sparkline';

interface Bucket {
  total: number;
  success: number;
  failed: number;
  bytes: number;
  avgDurationMs: number;
}

interface ChannelBucket extends Bucket {
  channel: string;
}

interface DailyBucket extends Bucket {
  date: string;
}

interface UsageResponse {
  today: Bucket;
  month: Bucket;
  byChannel: ChannelBucket[];
  daily: DailyBucket[];
}

interface SyncResponse {
  latest: {
    period_start: string;
    period_end: string;
    request_count: number | null;
    bandwidth_bytes: number | null;
    fetched_at: string;
  } | null;
  localCount: number | null;
  drift: number | null;
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

export default function BrightDataPage() {
  const toast = useToast();
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [sync, setSync] = useState<SyncResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 월말 예상 호출 수 (현재까지의 평균 일일 호출 수 × 이번 달 일수)
  const projected = useMemo(() => {
    if (!usage) return null;
    const now = new Date();
    const currentDay = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (currentDay < 1) return null;
    const ratePerDay = usage.month.total / currentDay;
    const projectedTotal = Math.round(ratePerDay * daysInMonth);
    const projectedBytes = Math.round((usage.month.bytes / currentDay) * daysInMonth);
    return { total: projectedTotal, bytes: projectedBytes, daysInMonth, currentDay };
  }, [usage]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, s] = await Promise.all([
        fetch('/api/brightdata/usage').then((r) => r.json()),
        fetch('/api/brightdata/sync').then((r) => r.json()),
      ]);
      if (u.error) throw new Error(u.error);
      setUsage(u);
      if (!s.error) setSync(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : '로드 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
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
      await load();
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

      {/* 오늘/이번 달/예상 KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <BucketCard title="오늘 (KST)" bucket={usage.today} />
        <BucketCard title="이번 달 (KST)" bucket={usage.month} />
        {projected && (
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="text-sm text-gray-500 mb-2">월말 예상</div>
            <div className="text-3xl font-bold text-gray-900 mb-3">
              {formatNumber(projected.total)}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-gray-500">예상 대역폭</div>
                <div className="font-semibold text-gray-700">
                  {formatBytes(projected.bytes)}
                </div>
              </div>
              <div>
                <div className="text-gray-500">진행률</div>
                <div className="font-semibold text-gray-700">
                  {projected.currentDay}/{projected.daysInMonth}일
                </div>
              </div>
            </div>
            <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-500 h-1.5"
                style={{
                  width: `${Math.round((projected.currentDay / projected.daysInMonth) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 채널별 분포 */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">채널별 (이번 달)</h2>
        {usage.byChannel.length === 0 ? (
          <div className="text-sm text-gray-500">데이터 없음</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-500 text-left">
              <tr>
                <th className="py-2">채널</th>
                <th className="py-2 text-right">호출</th>
                <th className="py-2 text-right">성공</th>
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
      </div>

      {/* 일별 추이 */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-lg font-semibold text-gray-800">일별 추이 (최근 14일)</h2>
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
            아직 동기화된 스냅샷이 없습니다. <code>BRIGHTDATA_STATS_URL</code> 환경 변수 설정 후 동기화를 실행하세요.
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
            </div>
            <div className="text-gray-700">
              로컬 카운트: <span className="font-semibold">{formatNumber(sync.localCount ?? 0)}</span>
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

function BucketCard({ title, bucket }: { title: string; bucket: Bucket }) {
  const failRate = bucket.total === 0 ? 0 : (bucket.failed / bucket.total) * 100;
  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <div className="text-sm text-gray-500 mb-2">{title}</div>
      <div className="text-3xl font-bold text-gray-900 mb-3">{formatNumber(bucket.total)}</div>
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
