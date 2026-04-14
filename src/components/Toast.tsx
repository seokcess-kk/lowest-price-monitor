'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  expiresAt: number;
}

interface ToastContextValue {
  show: (message: string, kind?: ToastKind, durationMs?: number) => void;
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback(
    (message: string, kind: ToastKind = 'info', durationMs = 3500) => {
      const id = Date.now() + Math.random();
      const expiresAt = Date.now() + durationMs;
      setItems((prev) => [...prev, { id, kind, message, expiresAt }]);
    },
    []
  );

  const success = useCallback(
    (message: string, durationMs?: number) => show(message, 'success', durationMs),
    [show]
  );
  const error = useCallback(
    (message: string, durationMs?: number) => show(message, 'error', durationMs),
    [show]
  );

  // expiresAt 지난 toast를 주기적으로 제거 (기존 state 정리)
  useEffect(() => {
    if (items.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setItems((prev) => prev.filter((t) => t.expiresAt > now));
    }, 500);
    return () => clearInterval(timer);
  }, [items.length]);

  return (
    <ToastContext.Provider value={{ show, success, error }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-[90vw] sm:max-w-sm pointer-events-none">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-md border px-4 py-3 shadow-md text-sm animate-in fade-in slide-in-from-top-2 ${
              t.kind === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : t.kind === 'success'
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}
            role="status"
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
          >
            <div className="flex items-start gap-2">
              <span>
                {t.kind === 'error' ? '⚠' : t.kind === 'success' ? '✓' : 'ℹ'}
              </span>
              <span className="flex-1 whitespace-pre-line">{t.message}</span>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
