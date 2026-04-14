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
| **Supabase** | 상품/가격/수집요청/사용량 데이터 저장 |
| **GitHub Actions** | 가격 수집 워크플로우 (cron + workflow_dispatch) |
| **Bright Data Web Unlocker** | 봇 차단 우회된 HTML 응답 (3개 채널 모두 사용) |

## 채널별 수집 방식

| 채널 | 방식 | 구현 |
|------|------|------|
| **쿠팡** | Web Unlocker → Schema.org JSON-LD `offers.price` (+ DOM 폴백) | `src/scraper/channels/coupang.ts` |
| **네이버** | Web Unlocker → `product_is_lowest_price__` modifier 행에서 가격·판매처 페어링 추출 (+ 검색 API 폴백) | `src/scraper/channels/naver.ts` |
| **다나와** | Web Unlocker → `.box__price.lowest` modifier가 붙은 `li.list-item`에서 가격·판매처 페어링 추출 | `src/scraper/channels/danawa.ts` |

세 채널 모두 fetch 기반이라 서버리스/CI 환경에서 동작합니다. 한 상품의 3채널은 동시에 호출(`Promise.all`)되며, 채널 간 결과는 `price_logs`에 bulk insert로 저장됩니다.

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

대시보드 "즉시 수집" 버튼이 GitHub Actions를 dispatch하려면 추가로 PAT가 필요합니다. 로컬 개발에서도 동일하게 `.env.local`에 넣으면 됩니다.

```env
GITHUB_TOKEN=ghp_xxx     # repo + workflow scope PAT
GITHUB_REPOSITORY=user/repo
GITHUB_WORKFLOW_FILE=collect-prices.yml  # 선택, 기본값 동일
```

### 2. DB 마이그레이션 적용

`supabase/migrations/` 폴더의 SQL을 순서대로 Supabase Dashboard → SQL Editor에서 실행:

| 파일 | 내용 |
|------|------|
| `001_init.sql` | products / price_logs / scrape_errors (FK는 ON DELETE CASCADE) |
| `002_collect_requests.sql` | 즉시 수집 요청 큐 |
| `003_brightdata_usage.sql` | Bright Data 사용량 추적 |
| `004_collect_requests_progress.sql` | progress_done / progress_total 컬럼 추가 (진행률 표시) |
| `005_sabangnet_code.sql` | products.sabangnet_code (사방넷 ERP 상품코드, 선택 필드) + 부분 인덱스. UNIQUE는 걸지 않고 앱 레이어에서 중복 확인 |

### 3. 설치 및 실행

```bash
npm install
npm run dev
```

### 4. 로컬 수동 수집

```bash
npm run collect
```

`.env.local`을 자동 로드해서 한 번 수집하고 종료합니다 (collect_requests 큐와 무관).

## 자동 수집 / 즉시 수집

| 트리거 | 동작 |
|--------|------|
| **GitHub Actions cron** | 매일 09:00 KST (00:00 UTC) 자동 실행. `collect_requests` 큐 사용 안 함 |
| **대시보드 "즉시 수집" 버튼** | `POST /api/collect` → `collect_requests` 큐 row 생성(`pending`) → GitHub Actions `workflow_dispatch` (`inputs.request_id` 전달) → 워크플로우가 시작 시 `running`으로, 매 상품 처리 후 `progress_done` 증가, 완료 시 `completed`로 row 업데이트 |

### 진행률 표시와 자동 폴링 복원

- 메인 대시보드는 `GET /api/collect`를 3초마다 폴링하여 `progress_done / progress_total` 으로 "X / N 상품 완료" 메시지 + 진행 바를 표시합니다.
- 페이지 마운트 시 한 번 GET 호출해서 진행 중(`pending` / `running`) 요청이 있으면 폴링을 자동 재시작합니다. **다른 메뉴로 이동 후 돌아와도** 진행 상황이 계속 보입니다.
- 수집 자체는 GitHub Actions 클라우드에서 돌기 때문에 PC를 끄거나 탭을 닫아도 끝까지 진행됩니다.

## 대시보드 기능

### 메인 페이지 (`/`)

- **KPI 카드**: 총 상품 / 가격 변동 상품 / 평균 변동률 / 수집 실패 4개
- **검색·필터·정렬**: 상품명 검색, 변동/대폭 하락/실패 필터 칩, 컬럼 정렬
- **컴팩트 테이블 뷰**: 한 행에 상품명·최저가·변동률·7일 sparkline + 최저가 채널 👑 뱃지. 행 클릭 시 채널별 카드 펼침
- **카드 뷰** (default): 모바일·태블릿 친화적, 상품당 카드 1개
- **채널 카드 클릭 영역**: 가격·판매처·외부 링크가 한 영역으로 묶여 카드 어디를 클릭해도 해당 채널 페이지로 이동
- **즉시 수집** 버튼 + 진행률 바 + 자동 폴링 복원
- **Excel 내보내기**: 현재 화면(필터 적용) 스냅샷을 .xlsx로 저장

### 상품 관리 페이지 (`/products/manage`)

- **컴팩트 테이블**: 체크박스·이름·채널 점·상태·등록일·⋯ 액션. 행 클릭 시 채널 URL 펼침
- **검색·활성 필터·정렬** (이름·등록일·상태)
- **등록/수정 모달**: 페이지 점유 없이 중앙 모달
- **행 ⋯ 메뉴**: 수정 / 활성·비활성 / 영구 삭제 (cascade)
- **체크박스 다중 선택 + 일괄 작업 바**: 일괄 활성/비활성/삭제
- **Excel 일괄 등록**:
  - **양식 다운로드** (.xlsx, 300px 열 너비, 헤더 bold + 음영)
  - 업로드 → **미리보기** (신규/URL중복/이름유사/오류 4분류)
  - URL 중복은 자동 차단, 이름 유사는 체크박스로 등록 여부 선택

### 상품 상세 페이지 (`/products/[id]`)

- **헤더**: 상품명·뒤로가기·상품 관리 버튼·현재 최저가·변동률·3채널 인라인 카드(URL 링크)
- **KPI 카드 5개**: 기간 내 최저/최고/평균/시작 대비 변동/수집 횟수
- **차트 카드**:
  - 카드 헤더에 기간 토글(7일/30일/90일/전체) + 모드 토글(통합/분리)
  - 채널 토글 칩 — 라인 ON/OFF
  - 통합 모드: 한 차트, Y축 dataMin~dataMax 도메인
  - 분리 모드: 채널마다 작은 차트 3개
- **수집 로그**:
  - 채널 필터 칩 / "변동만 보기" 토글
  - 클릭 페이지네이션 (25건/페이지)
  - 압축 행 (시간/채널/가격/판매처)

### Export 페이지 (`/export`)

- 검색·필터·프리셋 + 일별 집계 모드 + Excel 다운로드 (열 너비 자동)

### 에러 로그 페이지 (`/errors`)

- 수집 실패 이력

## DB 스키마

| 테이블 | 용도 |
|--------|------|
| `products` | 상품 정보 (이름, 채널별 URL, 활성 여부) |
| `price_logs` | 가격 수집 로그 (채널, 가격, 판매처, 수집일시). FK ON DELETE CASCADE |
| `scrape_errors` | 수집 실패 로그. FK ON DELETE CASCADE |
| `collect_requests` | 즉시 수집 요청 큐 (status / progress_done / progress_total / result_success / result_failed / error_message) |
| `brightdata_usage_logs` | Bright Data 호출 사용량 (채널 / 상태 / 응답 바이트 / 소요 시간) |

## 프로젝트 구조

```
src/
  app/                       # Next.js App Router
    api/
      collect/               # 즉시 수집 트리거 + 상태 폴링 (GitHub workflow_dispatch)
      prices/                # latest / sparkline / 일반 조회
      products/              # CRUD + [id]/(GET·PUT·DELETE) + bulk-action / bulk-create / check-duplicates
      export/                # 데이터 Export API
      errors/                # 에러 로그 API
    products/[id]/           # 상품 상세 페이지 (헤더·KPI·차트·로그)
    products/manage/         # 상품 관리 페이지 (모달·일괄 작업·Excel 가져오기)
    export/                  # Export 페이지
    errors/                  # 에러 로그 페이지
  components/                # 공용 UI (PriceTable, PriceCardList, PriceChart, Sparkline, Modal,
                             #          CsvImportModal, SummaryCards, SearchInput, FilterChips,
                             #          ViewToggle, PriceChangeIndicator)
  hooks/                     # useLatestPrices / usePriceHistory / useProducts / useProduct /
                             #   useSparklines
  scraper/
    brightdata.ts            # callWebUnlocker (공통 fetch wrapper) + 사용량 buffer
    channels/
      coupang.ts             # 쿠팡 (Web Unlocker + JSON-LD + DOM 폴백)
      naver.ts               # 네이버 (Web Unlocker + DOM modifier + 검색 API 폴백)
      danawa.ts              # 다나와 (Web Unlocker + DOM modifier)
    index.ts                 # collectAll — 채널 병렬 호출 + bulk insert + onProgress 콜백
    utils.ts                 # parsePrice, randomDelay
  lib/
    supabase.ts              # Supabase 클라이언트
    export.ts                # CSV/Excel 변환
    price-utils.ts           # 변동률·KPI 집계
  types/
    database.ts              # TypeScript 타입 정의
scripts/
  collect.ts                 # 수집 진입점 (로컬 + CI 공용). COLLECT_REQUEST_ID env가 있으면
                             #   collect_requests row를 단계별로 update
.github/workflows/
  collect-prices.yml         # 일 1회 cron + workflow_dispatch (inputs.request_id)
supabase/migrations/
  001_init.sql
  002_collect_requests.sql
  003_brightdata_usage.sql
  004_collect_requests_progress.sql
  005_sabangnet_code.sql
```
