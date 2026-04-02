import * as XLSX from 'xlsx';

interface ExportRow {
  date: string;
  productName: string;
  channel: string;
  price: number;
  storeName: string | null;
}

export function exportToCSV(data: ExportRow[], filename: string): void {
  const header = '날짜,상품명,채널,가격,스토어명';
  const rows = data.map(
    (row) =>
      `${row.date},"${row.productName}",${row.channel},${row.price},"${row.storeName || ''}"`
  );
  const csv = '\uFEFF' + [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export function exportToExcel(data: ExportRow[], filename: string): void {
  const wsData = data.map((row) => ({
    날짜: row.date,
    상품명: row.productName,
    채널: row.channel,
    가격: row.price,
    스토어명: row.storeName || '',
  }));

  const ws = XLSX.utils.json_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
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
