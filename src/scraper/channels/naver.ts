import type { Page } from 'playwright';

export interface ScrapeResult {
  price: number;
  storeName: string | null;
}

/**
 * 네이버 쇼핑 검색 API를 사용하여 최저가를 조회한다.
 * 상품명으로 검색하여 최저가 + 판매처를 가져온다.
 */
export async function scrapeNaver(
  url: string,
  _page: Page,
  productName?: string
): Promise<ScrapeResult | null> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 설정되지 않았습니다');
  }

  if (!productName) {
    throw new Error('네이버 API 검색에는 상품명이 필요합니다');
  }

  const apiUrl = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(productName)}&display=5&sort=asc&exclude=used`;

  const res = await fetch(apiUrl, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`네이버 API 실패 (${res.status}): ${text.substring(0, 200)}`);
  }

  const data = await res.json();

  if (!data.items || data.items.length === 0) {
    throw new Error(`네이버 API 검색 결과 없음: "${productName}"`);
  }

  // 최저가 항목 (sort=asc로 이미 가격 오름차순)
  const item = data.items[0];
  const price = parseInt(item.lprice, 10);

  if (!price || price <= 0) {
    throw new Error('네이버 API 가격 데이터 없음');
  }

  return {
    price,
    storeName: item.mallName || null,
  };
}
