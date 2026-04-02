---
name: build-dashboard
description: "Next.js 대시보드 UI와 API 라우트를 구현하는 스킬. 현재 최저가 요약 테이블, 상품별 가격 추이 Recharts 차트, 상품 CRUD 관리, CSV/Excel Export. '대시보드', '프론트엔드', 'UI', 'API 라우트', '차트', 'Export', '상품 관리' 키워드에 트리거."
---

# Build Dashboard — 대시보드 구현 스킬

Next.js App Router 기반 API 라우트와 대시보드 UI를 구현한다.

## 아키텍처

```
src/app/
├── page.tsx                    ← 메인: 현재 최저가 요약
├── products/
│   ├── [id]/page.tsx           ← 상품 상세: 가격 추이 차트
│   └── manage/page.tsx         ← 상품 관리: 등록/수정
├── export/page.tsx             ← Export: CSV/Excel 다운로드
├── api/
│   ├── products/
│   │   ├── route.ts            ← GET(목록), POST(등록)
│   │   └── [id]/
│   │       ├── route.ts        ← PUT(수정)
│   │       └── toggle/route.ts ← PATCH(활성 토글)
│   ├── prices/
│   │   ├── route.ts            ← GET(이력 조회)
│   │   └── latest/route.ts     ← GET(최신 요약)
│   ├── collect/route.ts        ← POST(수동 수집)
│   └── export/route.ts         ← GET(Export 데이터)
├── layout.tsx                  ← 공통 레이아웃 + 네비게이션
└── globals.css
```

## Step 1: API 라우트 구현

### GET /api/products
- Supabase에서 상품 목록 조회
- 쿼리 파라미터: `active_only` (boolean, 기본 true)
- 응답: `Product[]`

### POST /api/products
- 상품 등록
- body: `{ name, coupang_url?, naver_url?, danawa_url? }`
- 응답: 생성된 `Product`

### PUT /api/products/[id]
- 상품 수정
- body: `{ name?, coupang_url?, naver_url?, danawa_url? }`

### PATCH /api/products/[id]/toggle
- is_active 토글
- 응답: 업데이트된 `Product`

### GET /api/prices
- 가격 이력 조회
- 쿼리: `product_id` (필수), `channel?`, `start_date?`, `end_date?`, `limit?`
- 응답: `PriceLog[]`

### GET /api/prices/latest
- 각 상품의 채널별 최신 가격 + 전일 대비 변동
- 응답: `PriceWithChange[]`
- 변동 계산: 오늘 최신가 - 전일 최신가 (같은 채널)

### POST /api/collect
- GitHub Actions workflow_dispatch API 호출로 수동 수집 트리거
- GitHub Token 필요 (환경 변수)

### GET /api/export
- 쿼리: `start_date`, `end_date`, `product_ids?` (쉼표 구분)
- 응답: Export용 데이터 배열

## Step 2: 공유 컴포넌트

| 컴포넌트 | 용도 |
|---------|------|
| `PriceTable` | 메인 페이지 최저가 요약 테이블 |
| `PriceChart` | 상품 상세 Recharts 라인 차트 |
| `ProductForm` | 상품 등록/수정 폼 |
| `DateRangePicker` | 기간 선택 (Export, 차트) |
| `Navigation` | 상단 네비게이션 바 |
| `PriceChangeIndicator` | ▲▼ 변동 표시 (빨강/파랑) |

## Step 3: 데이터 페칭 훅

| 훅 | API | 반환 타입 |
|----|-----|----------|
| `useProducts()` | GET /api/products | `Product[]` |
| `useLatestPrices()` | GET /api/prices/latest | `PriceWithChange[]` |
| `usePriceHistory(productId, options)` | GET /api/prices | `PriceLog[]` |
| `useExportData(options)` | GET /api/export | Export 데이터 |

훅은 SWR 또는 단순 fetch + useState/useEffect로 구현한다. 과도한 라이브러리 추가 지양.

## Step 4: 페이지 구현

### 메인 페이지 (`/`)
- `useLatestPrices()`로 데이터 로드
- `PriceTable` 컴포넌트로 상품×채널 그리드 표시
- 각 셀: 가격 + `PriceChangeIndicator`
- "즉시 수집" 버튼 → POST /api/collect

### 상품 상세 (`/products/[id]`)
- `usePriceHistory(id, { period })`로 기간별 데이터 로드
- `PriceChart`: Recharts `LineChart`로 채널별 라인 (색상 구분)
- 기간 선택: 7일 / 30일 / 90일 / 전체 버튼
- 하단: 최근 수집 로그 테이블

### 상품 관리 (`/products/manage`)
- 상품 등록: `ProductForm` (상품명 + 채널별 URL 입력)
- 상품 목록: 각 행에 수정/비활성화 버튼

### Export (`/export`)
- `DateRangePicker`로 기간 선택
- 상품 체크박스 (전체 선택 / 개별 선택)
- CSV 다운로드: `useExportData()` → Blob 생성 → 다운로드
- Excel 다운로드: SheetJS `XLSX.utils.json_to_sheet()` → `XLSX.writeFile()`

## Step 5: Export 유틸 (`src/lib/export.ts`)

```typescript
exportToCSV(data: ExportRow[], filename: string): void
exportToExcel(data: ExportRow[], filename: string): void
```

ExportRow 형식: `{ date, productName, channel, price, storeName }`

## UI 스타일 가이드
- Tailwind CSS 기본 유틸리티 사용
- 색상: 상승=`text-red-500`, 하락=`text-blue-500`, 변동 없음=`text-gray-500`
- 채널 색상: 쿠팡=`#E44232`, 네이버=`#03C75A`, 다나와=`#0068B7`
- 반응형: 모바일에서도 테이블 가로 스크롤 가능하도록
