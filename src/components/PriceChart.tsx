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

interface PriceChartProps {
  data: PriceLog[];
  visibleChannels?: Channel[];
  /** 'combined': 한 차트에 모든 채널 / 'split': 채널마다 별도 작은 차트 */
  mode?: 'combined' | 'split';
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

export default function PriceChart({
  data,
  visibleChannels,
  mode = 'combined',
  height = 400,
}: PriceChartProps) {
  const chartData = useMemo(() => {
    const dateMap = new Map<string, Record<string, number | string>>();
    const sorted = [...data].sort(
      (a, b) =>
        new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime()
    );
    for (const log of sorted) {
      const date = log.collected_at.split('T')[0];
      if (!dateMap.has(date)) {
        dateMap.set(date, { date });
      }
      const entry = dateMap.get(date)!;
      // 같은 날짜+채널은 가장 최신 값으로 덮어쓰기 (오래된순 정렬이라 마지막이 최신)
      entry[log.channel] = log.price;
    }
    return Array.from(dateMap.values());
  }, [data]);

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
          labelFormatter={(label) => `날짜: ${label}`}
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
            dot={{ r: 2 }}
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
