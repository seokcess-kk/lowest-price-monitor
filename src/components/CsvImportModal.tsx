'use client';

import { useState, useRef } from 'react';
import * as XLSX from 'xlsx-js-style';
import Modal from './Modal';

interface ParsedRow {
  rowIndex: number;
  name: string;
  coupang_url: string | null;
  naver_url: string | null;
  danawa_url: string | null;
  error?: string;
}

interface CsvImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

interface DupResult {
  rowIndex: number;
  status: 'new' | 'duplicate' | 'similar';
  duplicates: Array<{
    kind: 'urlMatch' | 'nameSimilar';
    productId: string;
    productName: string;
    matchedField?: 'coupang_url' | 'naver_url' | 'danawa_url';
  }>;
}

type Step = 'upload' | 'preview' | 'submitting' | 'done';

/** sheet의 행 객체 → ParsedRow 형태로 정규화. SheetJS json_to_sheet 출력 사용. */
function normalizeSheetRow(
  raw: Record<string, unknown>,
  rowIndex: number
): ParsedRow {
  const get = (keys: string[]): string => {
    for (const k of keys) {
      const v = raw[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
    return '';
  };

  const name = get(['name', '상품명', 'product']);
  const coupang = get(['coupang_url', 'coupang', '쿠팡', '쿠팡url']);
  const naver = get(['naver_url', 'naver', '네이버', '네이버url']);
  const danawa = get(['danawa_url', 'danawa', '다나와', '다나와url']);

  const row: ParsedRow = {
    rowIndex,
    name,
    coupang_url: coupang || null,
    naver_url: naver || null,
    danawa_url: danawa || null,
  };

  if (!row.name) {
    row.error = '상품명 누락';
  } else {
    for (const [field, value] of [
      ['coupang_url', row.coupang_url],
      ['naver_url', row.naver_url],
      ['danawa_url', row.danawa_url],
    ] as const) {
      if (value && !/^https?:\/\//i.test(value)) {
        row.error = `${field} 형식 오류`;
        break;
      }
    }
  }
  return row;
}

export default function CsvImportModal({
  open,
  onClose,
  onImported,
}: CsvImportModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [dupResults, setDupResults] = useState<Map<number, DupResult>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [includeSimilar, setIncludeSimilar] = useState(true);
  const [createdCount, setCreatedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const headers = ['name', 'coupang_url', 'naver_url', 'danawa_url'];
    const example = [
      '예시 상품 (이 행은 삭제하고 사용하세요)',
      'https://www.coupang.com/vp/products/123456789',
      'https://search.shopping.naver.com/catalog/12345678',
      'https://prod.danawa.com/info/?pcode=1234567',
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, example]);

    // 열 너비 — 300px
    ws['!cols'] = headers.map(() => ({ wpx: 300 }));

    // 헤더 셀(A1~D1) bold + 음영
    const headerStyle = {
      font: { bold: true, color: { rgb: '1F2937' } },
      fill: { patternType: 'solid', fgColor: { rgb: 'E5E7EB' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'thin', color: { rgb: '9CA3AF' } },
        bottom: { style: 'thin', color: { rgb: '9CA3AF' } },
        left: { style: 'thin', color: { rgb: '9CA3AF' } },
        right: { style: 'thin', color: { rgb: '9CA3AF' } },
      },
    };

    for (let c = 0; c < headers.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) {
        (ws[addr] as { s?: unknown }).s = headerStyle;
      }
    }

    // 예시 행 — 약간 흐린 텍스트
    const exampleStyle = {
      font: { color: { rgb: '9CA3AF' }, italic: true },
    };
    for (let c = 0; c < example.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 1, c });
      if (ws[addr]) {
        (ws[addr] as { s?: unknown }).s = exampleStyle;
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'products');

    XLSX.writeFile(wb, 'products-template.xlsx');
  };

  const reset = () => {
    setStep('upload');
    setRows([]);
    setDupResults(new Map());
    setError(null);
    setIncludeSimilar(true);
    setCreatedCount(0);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setError(null);

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: false,
    });
    const parsed = json.map((row, i) => normalizeSheetRow(row, i + 1));

    if (parsed.length === 0) {
      setError(
        '파일에서 유효한 행을 찾지 못했습니다. 첫 줄 헤더에 name(또는 상품명) 컬럼이 있어야 합니다.'
      );
      return;
    }
    setRows(parsed);

    // 중복 확인 API 호출 (오류 행은 제외)
    const checkItems = parsed
      .filter((r) => !r.error)
      .map((r) => ({
        rowIndex: r.rowIndex,
        name: r.name,
        coupang_url: r.coupang_url,
        naver_url: r.naver_url,
        danawa_url: r.danawa_url,
      }));

    if (checkItems.length > 0) {
      try {
        const res = await fetch('/api/products/check-duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: checkItems }),
        });
        const json = await res.json();
        if (res.ok && Array.isArray(json.results)) {
          const map = new Map<number, DupResult>();
          for (const r of json.results as DupResult[]) map.set(r.rowIndex, r);
          setDupResults(map);
        }
      } catch {
        /* 중복 확인 실패는 무시하고 미리보기로 진행 */
      }
    }

    setStep('preview');
  };

  const summary = (() => {
    let newCount = 0;
    let duplicate = 0;
    let similar = 0;
    let errors = 0;
    for (const r of rows) {
      if (r.error) {
        errors++;
        continue;
      }
      const dup = dupResults.get(r.rowIndex);
      if (!dup || dup.status === 'new') newCount++;
      else if (dup.status === 'duplicate') duplicate++;
      else if (dup.status === 'similar') similar++;
    }
    return { newCount, duplicate, similar, errors };
  })();

  const willInsertCount = summary.newCount + (includeSimilar ? summary.similar : 0);

  const handleSubmit = async () => {
    setStep('submitting');
    const items = rows
      .filter((r) => !r.error)
      .filter((r) => {
        const dup = dupResults.get(r.rowIndex);
        if (!dup || dup.status === 'new') return true;
        if (dup.status === 'similar') return includeSimilar;
        return false;
      })
      .map((r) => ({
        name: r.name,
        coupang_url: r.coupang_url,
        naver_url: r.naver_url,
        danawa_url: r.danawa_url,
      }));

    if (items.length === 0) {
      setError('등록할 항목이 없습니다.');
      setStep('preview');
      return;
    }

    try {
      const res = await fetch('/api/products/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '일괄 등록 실패');
        setStep('preview');
        return;
      }
      setCreatedCount(json.created ?? items.length);
      setStep('done');
      onImported();
    } catch {
      setError('일괄 등록 요청 중 오류가 발생했습니다.');
      setStep('preview');
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Excel 일괄 등록" size="xl">
      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Excel(.xlsx) 파일을 업로드하세요. 첫 줄은 헤더이며, 다음 컬럼을 인식합니다:
          </p>
          <ul className="text-xs text-gray-500 list-disc pl-5 space-y-0.5">
            <li>
              <code className="bg-gray-100 px-1 rounded">name</code> 또는{' '}
              <code className="bg-gray-100 px-1 rounded">상품명</code> (필수)
            </li>
            <li>
              <code className="bg-gray-100 px-1 rounded">coupang_url</code> /{' '}
              <code className="bg-gray-100 px-1 rounded">쿠팡</code>
            </li>
            <li>
              <code className="bg-gray-100 px-1 rounded">naver_url</code> /{' '}
              <code className="bg-gray-100 px-1 rounded">네이버</code>
            </li>
            <li>
              <code className="bg-gray-100 px-1 rounded">danawa_url</code> /{' '}
              <code className="bg-gray-100 px-1 rounded">다나와</code>
            </li>
          </ul>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={downloadTemplate}
              className="text-sm text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1"
            >
              📄 양식 다운로드 (.xlsx)
            </button>
            <span className="text-xs text-gray-400">스타일 · 한글 헤더 포함</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="block w-full text-sm border border-gray-300 rounded-md p-2"
          />
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="bg-green-50 border border-green-200 rounded p-2">
              <div className="font-semibold text-green-700">신규</div>
              <div className="text-xl font-bold text-green-700">
                {summary.newCount}
              </div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded p-2">
              <div className="font-semibold text-red-700">URL 중복</div>
              <div className="text-xl font-bold text-red-700">{summary.duplicate}</div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
              <div className="font-semibold text-yellow-700">이름 유사</div>
              <div className="text-xl font-bold text-yellow-700">
                {summary.similar}
              </div>
            </div>
            <div className="bg-gray-100 border border-gray-300 rounded p-2">
              <div className="font-semibold text-gray-700">오류</div>
              <div className="text-xl font-bold text-gray-700">{summary.errors}</div>
            </div>
          </div>

          {summary.similar > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeSimilar}
                onChange={(e) => setIncludeSimilar(e.target.checked)}
              />
              이름 유사 항목도 등록 ({summary.similar}건)
            </label>
          )}

          <div className="border border-gray-200 rounded max-h-96 overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left">#</th>
                  <th className="px-2 py-1 text-left">상품명</th>
                  <th className="px-2 py-1 text-center">상태</th>
                  <th className="px-2 py-1 text-left">비고</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dup = dupResults.get(r.rowIndex);
                  let badge: { text: string; color: string };
                  let note = '';
                  if (r.error) {
                    badge = { text: '오류', color: 'bg-gray-200 text-gray-700' };
                    note = r.error;
                  } else if (!dup || dup.status === 'new') {
                    badge = { text: '신규', color: 'bg-green-100 text-green-700' };
                  } else if (dup.status === 'duplicate') {
                    badge = { text: 'URL 중복', color: 'bg-red-100 text-red-700' };
                    note = `기존: ${dup.duplicates[0]?.productName ?? ''}`;
                  } else {
                    badge = { text: '이름 유사', color: 'bg-yellow-100 text-yellow-700' };
                    note = `기존: ${dup.duplicates[0]?.productName ?? ''}`;
                  }
                  return (
                    <tr key={r.rowIndex} className="border-t border-gray-100">
                      <td className="px-2 py-1 text-gray-400">{r.rowIndex}</td>
                      <td className="px-2 py-1 text-gray-800">{r.name || '-'}</td>
                      <td className="px-2 py-1 text-center">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.color}`}
                        >
                          {badge.text}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-gray-500">{note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setStep('upload')}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
            >
              다시 업로드
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={willInsertCount === 0}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {willInsertCount}건 등록
            </button>
          </div>
        </div>
      )}

      {step === 'submitting' && (
        <div className="text-center py-12 text-gray-500 text-sm">등록 중...</div>
      )}

      {step === 'done' && (
        <div className="text-center py-8 space-y-4">
          <div className="text-3xl">✅</div>
          <div className="text-gray-700">{createdCount}건 등록 완료</div>
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            닫기
          </button>
        </div>
      )}
    </Modal>
  );
}
