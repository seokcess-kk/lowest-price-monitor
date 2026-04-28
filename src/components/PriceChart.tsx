'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { PriceLog, Channel } from '@/types/database';
import { dateKeyKST } from '@/lib/date-utils';

interface PriceChartProps {
  data: PriceLog[];
  visibleChannels?: Channel[];
  /** 'combined': 한 차트에 모든 채널 / 'split': 채널마다 별도 작은 차트 */
  mode?: 'combined' | 'split';
  /**
   * 'daily' (기본): 같은 KST 날짜 같은 채널의 최저값 1점만.
   *   1회 이상치가 차트를 망치는 영향을 거의 0으로 만든다.
   * 'raw': 모든 수집 시각을 그대로 점으로 표시. 의심 데이터 검증 시 사용.
   */
  aggregation?: 'daily' | 'raw';
  height?: number;
}

const CHANNEL_COLORS: Record<Channel, string> = {
  coupang: '#E44232',
  naver: '#03C75A',
  danawa: '#0068B7',
};

const CHANNEL_LABELS: Record<Channel, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  danawa: '다나와',
};

const CHANNELS: Channel[] = ['coupang', 'naver', 'danawa'];

/** raw 모드용 분 단위 KST 키 — 같은 분에 들어온 다른 채널은 한 점에 합쳐진다 */
function minuteKeyKST(iso: string): string {
  const t = Date.parse(iso);
  const shifted = new Date(t + 9 * 60 * 60_000);
  // YYYY-MM-DD HH:mm
  return shifted.toISOString().slice(0, 16).replace('T', ' ');
}

export default function PriceChart({
  data,
  visibleChannels,
  mode = 'combined',
  aggregation = 'daily',
  height = 400,
}: PriceChartProps) {
  const chartData = useMemo(() => {
    const map = new Map<string, Record<string, number | string>>();
    const sorted = [...data].sort(
      (a, b) =>
        new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime()
    );
    for (const log of sorted) {
      const key =
        aggregation === 'daily' ? dateKeyKST(log.collected_at) : minuteKeyKST(log.collected_at);
      if (!map.has(key)) {
        map.set(key, { date: key });
      }
      const entry = map.get(key)!;
      const prev = entry[log.channel];
      if (aggregation === 'daily') {
        // 같은 날·채널은 최저값 채택 — 이상치는 보통 위로 튀므로 자동 보호
        if (typeof prev !== 'number' || (log.price as number) < prev) {
          entry[log.channel] = log.price;
        }
      } else {
        // raw: 같은 분의 같은 채널이면 마지막 값
        entry[log.channel] = log.price;
      }
    }
    return Array.from(map.values());
  }, [data, aggregation]);

  const activeChannels = useMemo(() => {
    const set = new Set<Channel>();
    for (const log of data) set.add(log.channel);
    const ordered = CHANNELS.filter((c) => set.has(c));
    if (visibleChannels) {
      return ordered.filter((c) => visibleChannels.includes(c));
    }
    return ordered;
  }, [data, visibleChannels]);

  if (data.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12">데이터가 없습니다.</div>
    );
  }

  if (activeChannels.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12">
        선택한 채널의 데이터가 없습니다.
      </div>
    );
  }

  if (mode === 'split') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {activeChannels.map((channel) => (
          <div key={channel}>
            <div
              className="text-xs font-semibold mb-1 px-1"
              style={{ color: CHANNEL_COLORS[channel] }}
            >
              ● {CHANNEL_LABELS[channel]}
            </div>
            <SingleChannelChart
              data={chartData}
              channel={channel}
              height={Math.round(height * 0.7)}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={chartData}
        margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="date" fontSize={11} tick={{ fill: '#6b7280' }} />
        <YAxis
          fontSize={11}
          tick={{ fill: '#6b7280' }}
          tickFormatter={(value: number) => value.toLocaleString('ko-KR')}
          domain={['dataMin - 500', 'dataMax + 500']}
          allowDecimals={false}
        />
        <Tooltip
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any) => {
            if (value === undefined || value === null) return ['-'];
            return [Number(value).toLocaleString('ko-KR') + '원'];
          }}
          labelFormatter={(label) =>
            aggregation === 'daily' ? `날짜: ${label}` : `시각: ${label}`
          }
          contentStyle={{ fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {activeChannels.map((channel) => (
          <Line
            key={channel}
            type="monotone"
            dataKey={channel}
            name={CHANNEL_LABELS[channel]}
            stroke={CHANNEL_COLORS[channel]}
            strokeWidth={2}
            dot={{ r: aggregation === 'daily' ? 3 : 2 }}
            activeDot={{ r: 5 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

interface SingleChannelChartProps {
  data: Array<Record<string, number | string>>;
  channel: Channel;
  height: number;
}

function SingleChannelChart({ data, channel, height }: SingleChannelChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="date" fontSize={10} tick={{ fill: '#6b7280' }} />
        <YAxis
          fontSize={10}
          tick={{ fill: '#6b7280' }}
          tickFormatter={(value: number) => value.toLocaleString('ko-KR')}
          domain={['dataMin - 500', 'dataMax + 500']}
          allowDecimals={false}
        />
        <Tooltip
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any) => {
            if (value === undefined || value === null) return ['-'];
            return [Number(value).toLocaleString('ko-KR') + '원'];
          }}
          labelFormatter={(label) => `날짜: ${label}`}
          contentStyle={{ fontSize: 11 }}
        />
        <Line
          type="monotone"
          dataKey={channel}
          name={CHANNEL_LABELS[channel]}
          stroke={CHANNEL_COLORS[channel]}
          strokeWidth={2}
          dot={{ r: 2 }}
          activeDot={{ r: 5 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
