'use client';

export type ViewMode = 'table' | 'card';

interface ViewToggleProps {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
}

export default function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
      <button
        type="button"
        onClick={() => onChange('table')}
        className={`px-3 py-1.5 text-xs font-medium ${
          value === 'table'
            ? 'bg-blue-600 text-white'
            : 'bg-white text-gray-700 hover:bg-gray-50'
        }`}
        aria-pressed={value === 'table'}
      >
        ☰ 테이블
      </button>
      <button
        type="button"
        onClick={() => onChange('card')}
        className={`px-3 py-1.5 text-xs font-medium border-l border-gray-300 ${
          value === 'card'
            ? 'bg-blue-600 text-white'
            : 'bg-white text-gray-700 hover:bg-gray-50'
        }`}
        aria-pressed={value === 'card'}
      >
        ▦ 카드
      </button>
    </div>
  );
}
