'use client';

export type ChangeFilter = 'all' | 'changed' | 'bigDrop' | 'failed';

interface FilterChipsProps {
  value: ChangeFilter;
  onChange: (next: ChangeFilter) => void;
  counts?: Partial<Record<ChangeFilter, number>>;
}

const OPTIONS: Array<{ key: ChangeFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'changed', label: '가격 변동' },
  { key: 'bigDrop', label: '5% 이상 하락' },
  { key: 'failed', label: '수집 실패' },
];

export default function FilterChips({ value, onChange, counts }: FilterChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {OPTIONS.map((opt) => {
        const active = value === opt.key;
        const count = counts?.[opt.key];
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              active
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600'
            }`}
          >
            {opt.label}
            {count !== undefined && (
              <span
                className={`ml-1.5 ${active ? 'text-blue-100' : 'text-gray-500'}`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
