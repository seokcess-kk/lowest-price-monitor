'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

interface Codec<T> {
  parse: (raw: string | null) => T;
  /** undefined/null이면 query 파라미터를 제거 */
  format: (value: T) => string | null | undefined;
}

type Updater<T> = T | ((prev: T) => T);

/**
 * URL query string과 React state를 양방향 동기화하는 훅.
 * - 초기 값은 searchParams에서 읽음 (SSR-safe). 없으면 default.
 * - 변경 시 router.replace로 URL 갱신 (스크롤 유지, 페이지 리로드 없음).
 * - 여러 키를 한 페이지에서 사용해도 같은 query string에 누적된다.
 *
 * 같은 tick에 여러 키를 동시에 업데이트할 때 (예: "모두 초기화") closure로 캡처된
 * searchParams snapshot이 같아 마지막 호출이 앞 호출들의 변경을 덮어쓰는 race가 있었다.
 * → 모듈 레벨 큐에 변경을 모아 microtask 1회로 router.replace를 통합한다.
 */

// 같은 tick에 발생한 모든 useUrlState 변경을 한 번의 router.replace로 합치는 큐.
// 모듈 레벨이라 같은 페이지의 여러 hook 인스턴스가 공유.
const pendingChanges = new Map<string, string | null>();
let flushScheduled = false;
let scheduledRouter: AppRouterInstance | null = null;
let scheduledPathname = '';

function scheduleFlush(router: AppRouterInstance, pathname: string) {
  scheduledRouter = router;
  scheduledPathname = pathname;
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    if (pendingChanges.size === 0 || !scheduledRouter) return;
    const params = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : ''
    );
    for (const [k, v] of pendingChanges) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    pendingChanges.clear();
    const qs = params.toString();
    scheduledRouter.replace(`${scheduledPathname}${qs ? `?${qs}` : ''}`, {
      scroll: false,
    });
  });
}

export function useUrlState<T>(
  key: string,
  defaultValue: T,
  codec: Codec<T>
): [T, (next: Updater<T>) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialRef = useRef<T | null>(null);
  if (initialRef.current === null) {
    initialRef.current = codec.parse(searchParams.get(key)) ?? defaultValue;
  }
  const [value, setValue] = useState<T>(initialRef.current);

  // 외부에서 query가 바뀌었을 때 (브라우저 뒤로가기 등) state 동기화
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    const parsed = codec.parse(searchParams.get(key)) ?? defaultValue;
    if (!shallowEqual(parsed, valueRef.current)) {
      setValue(parsed);
    }
    // codec/defaultValue는 호출 측에서 안정 참조여야 함 (호출 측 const 권장)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, key]);

  // 안정 ref setter — 호출 측 useMemo/useCallback deps에 추가하지 않아도 안전.
  const updateImplRef = useRef<(next: Updater<T>) => void>(() => {});
  updateImplRef.current = (next) => {
    const resolved =
      typeof next === 'function'
        ? (next as (prev: T) => T)(valueRef.current)
        : next;
    setValue(resolved);
    const formatted = codec.format(resolved);
    const queued =
      formatted === null || formatted === undefined || formatted === ''
        ? null
        : formatted;
    pendingChanges.set(key, queued);
    scheduleFlush(router, pathname);
  };
  const update = useCallback((next: Updater<T>) => updateImplRef.current(next), []);

  return [value, update];
}

function shallowEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  return false;
}

// 자주 쓰는 codec 모음 — 각 페이지에서 const로 import해서 useUrlState에 전달
export const stringCodec: Codec<string> = {
  parse: (raw) => raw ?? '',
  format: (v) => (v ? v : null),
};

export function enumCodec<T extends string>(
  options: readonly T[],
  defaultValue: T
): Codec<T> {
  const set = new Set<string>(options);
  return {
    parse: (raw) => (raw && set.has(raw) ? (raw as T) : defaultValue),
    format: (v) => (v === defaultValue ? null : v),
  };
}

export const stringSetCodec: Codec<Set<string>> = {
  parse: (raw) => {
    if (!raw) return new Set();
    return new Set(raw.split(',').filter(Boolean));
  },
  format: (v) => (v.size === 0 ? null : Array.from(v).join(',')),
};
