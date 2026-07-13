import type {
  ChannelPrice,
  PanelEntry,
  PanelGroups,
  PriceWithChange,
  SummaryStats,
} from '@/types/database';

export type { SummaryStats } from '@/types/database';

/**
 * 변동률 계산 — 어제 가격이 없거나 0이면 null.
 * change 필드는 (오늘가 - 어제가) 절대값이므로 어제가는 todayPrice - change로 역산.
 */
export function changePercent(price: ChannelPrice): number | null {
  if (price.change === null || price.change === undefined) return null;
  if (price.price <= 0) return null;
  const yesterday = price.price - price.change;
  if (yesterday <= 0) return null;
  return (price.change / yesterday) * 100;
}

/** 상품의 채널 중 가격이 0보다 큰 것만 */
export function activePrices(item: PriceWithChange): ChannelPrice[] {
  return item.prices.filter((p) => p.price > 0);
}

/** 상품의 최저가 채널 (없으면 null) */
export function cheapestChannel(item: PriceWithChange): ChannelPrice | null {
  const valid = activePrices(item);
  if (valid.length === 0) return null;
  return valid.reduce((min, curr) => (curr.price < min.price ? curr : min));
}

/** 상품의 최고가 채널 (없으면 null) */
export function maxPrice(item: PriceWithChange): number | null {
  const valid = activePrices(item);
  if (valid.length === 0) return null;
  return Math.max(...valid.map((p) => p.price));
}

/** 어제 대비 변동이 있는 채널이 하나라도 있는가 */
export function hasAnyChange(item: PriceWithChange): boolean {
  return item.prices.some((p) => p.change !== null && p.change !== 0);
}

/** 상품 단위 변동률 — 최저가 채널 기준 (없으면 null) */
export function productChangePercent(item: PriceWithChange): number | null {
  const cheapest = cheapestChannel(item);
  if (!cheapest) return null;
  return changePercent(cheapest);
}

/** 5% 이상 하락한 채널이 있는가 */
export function hasBigDrop(item: PriceWithChange, thresholdPct = 5): boolean {
  return item.prices.some((p) => {
    const pct = changePercent(p);
    return pct !== null && pct <= -thresholdPct;
  });
}

/** 수집 실패 경고가 하나라도 있는가 */
export function hasFailure(item: PriceWithChange): boolean {
  return !!item.warnings && item.warnings.length > 0;
}

/** URL이 하나도 없거나 모든 채널 가격이 0 — ActionPanels의 'URL 누락 / 미수집'과 동일 조건 */
export function hasMissing(item: PriceWithChange): boolean {
  const urlsAny =
    !!item.urls.coupang || !!item.urls.naver || !!item.urls.danawa;
  const noPrice = item.prices.every((p) => p.price <= 0);
  return !urlsAny || noPrice;
}

/** 가격 하락 (1% 이상) — ActionPanels '가격 하락 Top'과 동일 조건 */
export function hasDrop(item: PriceWithChange, thresholdPct = 1): boolean {
  const pct = productChangePercent(item);
  return pct !== null && pct <= -thresholdPct;
}

/** 가격 급등 (1% 이상) — ActionPanels '가격 급등 Top'과 동일 조건 */
export function hasRise(item: PriceWithChange, thresholdPct = 1): boolean {
  const pct = productChangePercent(item);
  return pct !== null && pct >= thresholdPct;
}

export function computeSummary(items: PriceWithChange[]): SummaryStats {
  const totalProducts = items.length;
  const changedProducts = items.filter(hasAnyChange).length;

  const pcts = items
    .map(productChangePercent)
    .filter((p): p is number => p !== null);
  const averageChangePct =
    pcts.length > 0 ? pcts.reduce((sum, v) => sum + v, 0) / pcts.length : null;

  const failedChannels = items.reduce(
    (acc, item) => acc + (item.warnings?.length ?? 0),
    0
  );

  return { totalProducts, changedProducts, averageChangePct, failedChannels };
}

/**
 * ActionPanels 4-패널 그룹핑 — Top N + 전체 카운트.
 * 원래 ActionPanels 컴포넌트 내부 useMemo였으나, 서버 페이지네이션 전환으로
 * "전체 상품 기준" 집계를 서버(api/dashboard)가 계산해야 해서 공용 모듈로 이동.
 */
export function computePanelGroups(
  items: PriceWithChange[],
  topN: number = 5
): PanelGroups {
  const drops: PanelEntry[] = [];
  const rises: PanelEntry[] = [];
  const failed: PriceWithChange[] = [];
  const missing: PriceWithChange[] = [];

  for (const item of items) {
    const pct = productChangePercent(item);
    if (pct !== null && pct <= -1) drops.push({ item, pct });
    if (pct !== null && pct >= 1) rises.push({ item, pct });
    if (hasFailure(item)) failed.push(item);
    if (hasMissing(item)) missing.push(item);
  }

  drops.sort((a, b) => a.pct - b.pct); // 가장 큰 하락 먼저 (음수 작은 값)
  rises.sort((a, b) => b.pct - a.pct);
  failed.sort((a, b) => (b.warnings?.length ?? 0) - (a.warnings?.length ?? 0));

  return {
    drops: drops.slice(0, topN),
    rises: rises.slice(0, topN),
    failed: failed.slice(0, topN),
    missing: missing.slice(0, topN),
    counts: {
      drops: drops.length,
      rises: rises.length,
      failed: failed.length,
      missing: missing.length,
    },
  };
}
