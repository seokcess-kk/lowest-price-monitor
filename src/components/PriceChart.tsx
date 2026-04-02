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

export default function PriceChart({ data }: PriceChartProps) {
  const chartData = useMemo(() => {
    // 날짜별로 그룹핑
    const dateMap = new Map<string, Record<string, number | string>>();

    // 오래된 순으로 정렬
    const sorted = [...data].sort(
      (a, b) => new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime()
    );

    for (const log of sorted) {
      const date = log.collected_at.split('T')[0];
      if (!dateMap.has(date)) {
        dateMap.set(date, { date });
      }
      const entry = dateMap.get(date)!;
      // 같은 날짜+채널에서 가장 최신 값 사용
      entry[log.channel] = log.price;
    }

    return Array.from(dateMap.values());
  }, [data]);

  const activeChannels = useMemo(() => {
    const channels = new Set<Channel>();
    for (const log of data) {
      channels.add(log.channel);
    }
    return Array.from(channels);
  }, [data]);

  if (data.length === 0) {
    return <div className="text-center text-gray-400 py-12">데이터가 없습니다.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" fontSize={12} />
        <YAxis
          fontSize={12}
          tickFormatter={(value: number) => value.toLocaleString('ko-KR')}
        />
        <Tooltip
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any) => {
            if (value === undefined || value === null) return ['-'];
            return [Number(value).toLocaleString('ko-KR') + '원'];
          }}
          labelFormatter={(label) => `날짜: ${label}`}
        />
        <Legend />
        {activeChannels.map((channel) => (
          <Line
            key={channel}
            type="monotone"
            dataKey={channel}
            name={CHANNEL_LABELS[channel]}
            stroke={CHANNEL_COLORS[channel]}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
