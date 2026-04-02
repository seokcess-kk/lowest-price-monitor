'use client';

import Link from 'next/link';
import type { PriceWithChange, Channel } from '@/types/database';
import PriceChangeIndicator from './PriceChangeIndicator';

interface PriceTableProps {
  data: PriceWithChange[];
}

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

const CHANNELS: Channel[] = ['coupang', 'naver', 'danawa'];

export default function PriceTable({ data }: PriceTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b">
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">상품명</th>
            {CHANNELS.map((ch) => (
              <th
                key={ch}
                className="px-4 py-3 text-center text-sm font-semibold"
                style={{ color: CHANNEL_COLORS[ch] }}
              >
                {CHANNEL_LABELS[ch]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={item.product_id} className="border-b hover:bg-gray-50">
              <td className="px-4 py-3">
                <Link
                  href={`/products/${item.product_id}`}
                  className="text-blue-600 hover:underline font-medium"
                >
                  {item.product_name}
                </Link>
              </td>
              {CHANNELS.map((ch) => {
                const channelPrice = item.prices.find((p) => p.channel === ch);
                const warning = item.warnings?.find((w) => w.channel === ch);
                return (
                  <td key={ch} className="px-4 py-3 text-center">
                    {warning && (
                      <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 mb-1">
                        연속 {warning.consecutive_failures}회 수집 실패
                      </div>
                    )}
                    {channelPrice && channelPrice.price > 0 ? (
                      <div className="flex flex-col items-center gap-1">
                        <span className="font-medium">
                          {channelPrice.price.toLocaleString('ko-KR')}원
                        </span>
                        <PriceChangeIndicator change={channelPrice.change} />
                        {channelPrice.store_name && (
                          <span className="text-xs text-gray-400">{channelPrice.store_name}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
