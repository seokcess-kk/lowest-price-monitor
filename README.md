# 최저가 모니터링 시스템

쿠팡, 네이버, 다나와 3개 채널의 상품 가격을 자동 수집하고 대시보드에서 모니터링하는 시스템.

## 아키텍처

```
Vercel (대시보드)  ──→  GitHub Actions (수집)  ──→  Supabase (DB)
        ↑                       ↓                        ↑
        └───────────── 폴링/조회 ──────────────────────────┘
```

| 구성 요소 | 역할 |
|----------|------|
| **Next.js (Vercel)** | 대시보드 UI, API 라우트 |
| **Supabase** | 상품/가격/수집요청 데이터 저장 |
| **GitHub Actions** | 가격 수집 워크플로우 (cron + workflow_dispatch) |
| **Bright Data Web Unlocker** | 봇 차단 우회된 HTML 응답 (3개 채널 모두 사용) |

## 채널별 수집 방식

| 채널 | 방식 | 구현 |
|------|------|------|
| **쿠팡** | Web Unlocker → Schema.org JSON-LD `offers.price` (+ DOM 폴백) | `src/scraper/channels/coupang.ts` |
| **네이버** | Web Unlocker → `product_is_lowest_price__` modifier가 붙은 행에서 가격·판매처 페어링 추출 (+ 검색 API 폴백) | `src/scraper/channels/naver.ts` |
| **다나와** | Web Unlocker → `.box__price.lowest` modifier가 붙은 `li.list-item`에서 가격·판매처 페어링 추출 | `src/scraper/channels/danawa.ts` |

세 채널 모두 fetch 기반이라 서버리스/CI 환경에서 동작합니다.

## 시작하기

### 1. 환경 변수 설정

`.env.local` 파일 생성:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
BRIGHTDATA_API_TOKEN=your_brightdata_token
BRIGHTDATA_ZONE=your_unlocker_zone
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret
```

Vercel 배포 시에는 추가로 다음 변수가 필요합니다 (`즉시 수집` 버튼이 GitHub Actions를 dispatch하기 위함):

```env
GITHUB_TOKEN=ghp_xxx     # repo + workflow scope PAT
GITHUB_REPOSITORY=user/repo
GITHUB_WORKFLOW_FILE=collect-prices.yml  # 선택, 기본값 동일
```

### 2. 설치 및 실행

```bash
npm install
npm run dev
```

### 3. 로컬 수집 (수동 테스트)

```bash
npm run collect
```

`.env.local`을 자동 로드해서 한 번 수집하고 종료합니다.

## 자동 수집 / 즉시 수집

| 트리거 | 동작 |
|--------|------|
| **GitHub Actions cron** | 매일 09:00 KST (00:00 UTC) 자동 실행 |
| **대시보드 "즉시 수집" 버튼** | `POST /api/collect` → `collect_requests` 큐 row 생성 → GitHub Actions `workflow_dispatch` 호출 → 워크플로우가 row의 `request_id`를 받아 시작/완료 시 상태 업데이트 |

## 대시보드 기능

- **메인**: KPI 카드, 채널별 최저가 요약, 검색·필터·정렬, 컴팩트 행 펼침, 7일 sparkline, 카드/테이블 뷰 토글
- **상품 관리**: 컴팩트 테이블, 검색·필터, 정렬, 행 펼침, 일괄 작업, Excel 일괄 등록(중복 검사 미리보기), Excel 양식 다운로드
- **상품 상세**: 가격 추이 차트 (Recharts), 수집 로그
- **Export**: CSV/Excel 다운로드
- **에러 로그**: 수집 실패 이력

## DB 스키마

| 테이블 | 용도 |
|--------|------|
| `products` | 상품 정보 (이름, 채널별 URL, 활성 여부) |
| `price_logs` | 가격 수집 로그 (채널, 가격, 판매처, 수집일시) |
| `scrape_errors` | 수집 실패 로그 |
| `collect_requests` | 즉시 수집 요청 큐 (상태 폴링용) |

## 프로젝트 구조

```
src/
  app/                       # Next.js App Router
    api/
      collect/               # 즉시 수집 트리거 + 상태 폴링
      prices/                # 가격 조회 API (latest, sparkline 등)
      products/              # 상품 CRUD + bulk-action / bulk-create / check-duplicates
      export/                # 데이터 Export API
      errors/                # 에러 로그 API
    products/manage/         # 상품 관리 페이지
  components/                # UI 컴포넌트 (PriceTable, Modal, Sparkline 등)
  hooks/                     # React 커스텀 훅
  scraper/
    channels/
      coupang.ts             # 쿠팡 (Web Unlocker + JSON-LD)
      naver.ts               # 네이버 (Web Unlocker + DOM modifier + API 폴백)
      danawa.ts              # 다나와 (Web Unlocker + DOM modifier)
    index.ts                 # 수집 오케스트레이터
    utils.ts                 # parsePrice, randomDelay
  lib/
    supabase.ts              # Supabase 클라이언트
    export.ts                # CSV/Excel 변환
    price-utils.ts           # 변동률·KPI 집계
  types/
    database.ts              # TypeScript 타입 정의
scripts/
  collect.ts                 # 수집 진입점 (로컬 + CI 공용)
.github/workflows/
  collect-prices.yml         # 일 1회 cron + workflow_dispatch
```
