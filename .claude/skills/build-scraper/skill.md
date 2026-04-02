---
name: build-scraper
description: "Playwright 기반 가격 수집 스크래퍼를 구현하는 스킬. 쿠팡, 네이버 가격비교, 다나와 채널별 파서 개발. '스크래퍼', '크롤러', '가격 수집', '쿠팡 파싱', '네이버 파싱', '다나와 파싱', 'Playwright' 키워드에 트리거."
---

# Build Scraper — 가격 수집기 구현 스킬

Playwright 기반 3채널(쿠팡/네이버/다나와) 가격 수집기를 구현한다.

## 아키텍처

```
scripts/collect.ts          ← CLI 진입점 (GitHub Actions 호출)
  └→ src/scraper/index.ts   ← 수집 오케스트레이터
       ├→ channels/coupang.ts
       ├→ channels/naver.ts
       ├→ channels/danawa.ts
       └→ utils.ts           ← 공통 유틸리티
```

## Step 1: 공통 유틸리티 (`src/scraper/utils.ts`)

```typescript
// 필수 유틸리티:
parsePrice(text: string): number | null
// "12,500원" → 12500, 파싱 실패 시 null

delay(ms: number): Promise<void>
// 요청 간 딜레이 (안티봇 대응)

createBrowser(): Promise<Browser>
// Playwright 브라우저 인스턴스 생성 (headless, 적절한 User-Agent)
```

## Step 2: 채널별 파서

각 파서는 동일한 인터페이스를 따른다:

```typescript
interface ScrapeResult {
  price: number;
  storeName: string | null;
}

type ChannelScraper = (url: string, page: Page) => Promise<ScrapeResult | null>;
```

### 쿠팡 파서
- 상품 페이지 로드 후 가격 요소 셀렉터로 추출
- 주의: 쿠팡은 동적 렌더링이므로 가격 요소 로드 대기 필요
- store_name은 null (쿠팡 직접 판매)
- 셀렉터 후보: `.prod-sale-price .total-price strong`, 변경 시 대응 필요

### 네이버 가격비교 파서
- 가격비교 탭의 최저가 행에서 가격 + 스토어명 추출
- 네이버 쇼핑 가격비교 URL 형식 처리
- 셀렉터 후보: 가격비교 테이블의 첫 번째 행

### 다나와 파서
- 가격비교 테이블에서 최저가 행의 가격 + 스토어명 추출
- 다나와 상품 URL 형식 처리
- 셀렉터 후보: `.lowest_List` 또는 가격비교 영역

### 파서 공통 규칙
- 페이지 로드 타임아웃: 30초
- 요소 대기 타임아웃: 10초
- 파싱 실패 시 null 반환 (절대 잘못된 가격 저장 금지)
- 각 채널 간 2~5초 랜덤 딜레이

## Step 3: 수집 오케스트레이터 (`src/scraper/index.ts`)

```typescript
async function collectAll(options?: { isManual?: boolean }): Promise<CollectResult>
```

1. Supabase에서 활성 상품 목록 조회 (`is_active = true`)
2. 각 상품에 대해 등록된 채널 URL로 수집 실행
3. 채널별 독립 try-catch: 한 채널 실패해도 나머지 계속
4. 수집 결과를 `price_logs`에 bulk insert
5. 결과 요약 반환: 성공/실패 건수, 에러 목록

## Step 4: CLI 진입점 (`scripts/collect.ts`)

```typescript
// GitHub Actions에서 호출: npx tsx scripts/collect.ts
import { collectAll } from '../src/scraper';

async function main() {
  const result = await collectAll({ isManual: false });
  console.log(`수집 완료: ${result.success}건 성공, ${result.failed}건 실패`);
  if (result.errors.length > 0) {
    console.error('에러:', result.errors);
    process.exit(1); // GitHub Actions에 실패 알림
  }
}
main();
```

## 주의사항
- 셀렉터는 사이트 업데이트로 변경될 수 있다. 유지보수성을 위해 셀렉터를 상수로 분리한다.
- Playwright는 GitHub Actions에서 `npx playwright install chromium`으로 브라우저를 설치해야 한다.
- 프로덕션 환경에서는 stealth 플러그인 고려 (playwright-extra + stealth plugin).
