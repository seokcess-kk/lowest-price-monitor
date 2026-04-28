'use client';

interface ChipItem {
  /** 화면 표시 라벨 (예: "검색: 락앤락", "브랜드: PB") */
  label: string;
  /** 이 칩의 X 버튼이 호출하는 단일 해제 핸들러 — 미지정이면 X 없이 표시 */
  onRemove?: () => void;
  /** 시각 구분용 톤 */
  tone?: 'search' | 'filter' | 'brand';
}

interface Props {
  items: ChipItem[];
  onClearAll?: () => void;
  /** 매치된 항목 수 (선택). N건 일치 같은 카운트 표기 */
  matchedCount?: number;
  totalCount?: number;
}

const TONE_CLASS: Record<NonNullable<ChipItem['tone']>, string> = {
  search: 'bg-blue-50 border-blue-200 text-blue-800',
  filter: 'bg-amber-50 border-amber-200 text-amber-800',
  brand: 'bg-purple-50 border-purple-200 text-purple-800',
};

/**
 * 현재 적용된 필터를 한눈에 보여주는 칩 바.
 * items가 0개면 렌더하지 않는다(노이즈 방지).
 */
export default function ActiveFilterChips({
  items,
  onClearAll,
  matchedCount,
  totalCount,
}: Props) {
  if (items.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-md bg-gray-50 border border-gray-200 mb-3"
      role="status"
      aria-label="현재 적용된 필터"
    >
      <span className="text-[11px] text-gray-500 font-medium">적용 중:</span>
      {items.map((item, idx) => {
        const tone = TONE_CLASS[item.tone ?? 'filter'];
        return (
          <span
            key={`${item.label}-${idx}`}
            className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full border ${tone}`}
          >
            {item.label}
            {item.onRemove && (
              <button
                type="button"
                onClick={item.onRemove}
                aria-label={`${item.label} 해제`}
                className="text-current/70 hover:text-current focus:outline-none focus-visible:ring-1 focus-visible:ring-current rounded-full w-3.5 h-3.5 inline-flex items-center justify-center leading-none"
              >
                ×
              </button>
            )}
          </span>
        );
      })}
      {typeof matchedCount === 'number' && typeof totalCount === 'number' && (
        <span className="text-[11px] text-gray-500 ml-1">
          {matchedCount}/{totalCount}건
        </span>
      )}
      {onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-auto text-[11px] text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        >
          모두 초기화
        </button>
      )}
    </div>
  );
}
