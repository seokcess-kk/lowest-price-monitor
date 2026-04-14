import type { ChannelPrice, PriceWithChange } from '@/types/database';

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

/** 전체 KPI 집계 */
export interface SummaryStats {
  totalProducts: number;
  changedProducts: number;
  averageChangePct: number | null;
  failedChannels: number;
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
