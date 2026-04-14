import * as XLSX from 'xlsx';
import type { PriceWithChange, Channel } from '@/types/database';

interface ExportRow {
  date: string;
  productName: string;
  sabangnetCode: string | null;
  channel: string;
  price: number;
  storeName: string | null;
}

const CHANNEL_LABEL: Record<Channel, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  danawa: '다나와',
};

export function exportToCSV(data: ExportRow[], filename: string): void {
  const header = '날짜,상품명,사방넷코드,채널,가격,스토어명';
  const rows = data.map(
    (row) =>
      `${row.date},"${row.productName}","${row.sabangnetCode ?? ''}",${row.channel},${row.price},"${row.storeName || ''}"`
  );
  const csv = '\uFEFF' + [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export function exportToExcel(data: ExportRow[], filename: string): void {
  const wsData = data.map((row) => ({
    날짜: row.date,
    상품명: row.productName,
    사방넷코드: row.sabangnetCode || '',
    채널: row.channel,
    가격: row.price,
    스토어명: row.storeName || '',
  }));

  const ws = XLSX.utils.json_to_sheet(wsData);
  ws['!cols'] = [
    { wpx: 85 },  // 날짜
    { wpx: 375 }, // 상품명
    { wpx: 120 }, // 사방넷코드
    { wpx: 75 },  // 채널
    { wpx: 75 },  // 가격
    { wpx: 150 }, // 스토어명
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

/**
 * 메인 화면 스냅샷(상품 1행 × 채널 컬럼 와이드 포맷) Excel 내보내기.
 * 검색·필터·정렬 적용 후 화면에 보이는 그대로 받기 위해 호출자가 정리된 데이터를 넘긴다.
 *
 * 헤더(12열): 상품명 / 사방넷코드 / 쿠팡 / 스토어 / 링크 / 네이버 / 스토어 / 링크 / 다나와 / 스토어 / 링크 / 최저가 / 최저채널
 * "스토어"·"링크"가 채널마다 반복되므로 객체 키 방식 대신 aoa_to_sheet로 직접 행 배열을 구성.
 * 쿠팡은 스토어명이 별도로 노출되지 않으므로 빈 문자열.
 */
export function exportSnapshotToExcel(data: PriceWithChange[], filename: string): void {
  const channels: Channel[] = ['coupang', 'naver', 'danawa'];

  const header = [
    '상품명', '사방넷코드',
    '쿠팡', '스토어', '링크',
    '네이버', '스토어', '링크',
    '다나와', '스토어', '링크',
    '최저가', '최저채널',
  ];

  const rows: Array<Array<string | number>> = data.map((item) => {
    const priceMap = new Map(item.prices.map((p) => [p.channel, p]));

    let lowestPrice = Infinity;
    let lowestChannel: Channel | null = null;
    for (const ch of channels) {
      const cp = priceMap.get(ch);
      if (cp && cp.price < lowestPrice) {
        lowestPrice = cp.price;
        lowestChannel = ch;
      }
    }

    const row: Array<string | number> = [item.product_name, item.sabangnet_code ?? ''];
    for (const ch of channels) {
      const cp = priceMap.get(ch);
      row.push(cp ? cp.price : '');
      // 쿠팡은 스토어명 미노출 → 항상 빈칸
      row.push(ch === 'coupang' ? '' : cp?.store_name ?? '');
      row.push(item.urls[ch] ?? '');
    }
    row.push(lowestChannel ? lowestPrice : '');
    row.push(lowestChannel ? CHANNEL_LABEL[lowestChannel] : '');
    return row;
  });

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);

  // 링크 셀은 hyperlink로 변환
  // 사방넷코드 컬럼이 1번째 자리에 들어가 링크 컬럼은 +1씩 이동 (4/7/10)
  const linkColumns = [4, 7, 10];
  for (let r = 0; r < rows.length; r++) {
    for (const c of linkColumns) {
      const url = rows[r][c];
      if (typeof url === 'string' && url) {
        const cellRef = XLSX.utils.encode_cell({ r: r + 1, c });
        ws[cellRef] = {
          t: 's',
          v: url,
          l: { Target: url, Tooltip: url },
        };
      }
    }
  }

  ws['!cols'] = [
    { wpx: 280 }, // 상품명
    { wpx: 120 }, // 사방넷코드
    { wpx: 85 },  // 쿠팡
    { wpx: 100 }, // 스토어
    { wpx: 200 }, // 링크
    { wpx: 85 },  // 네이버
    { wpx: 120 }, // 스토어
    { wpx: 200 }, // 링크
    { wpx: 85 },  // 다나와
    { wpx: 120 }, // 스토어
    { wpx: 200 }, // 링크
    { wpx: 90 },  // 최저가
    { wpx: 75 },  // 최저채널
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '현재최저가');
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
