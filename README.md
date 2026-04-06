# 최저가 모니터링 시스템

쿠팡, 네이버, 다나와 3개 채널의 상품 가격을 자동 수집하고 대시보드에서 모니터링하는 시스템.

## 아키텍처

```
Vercel (대시보드)  ←→  Supabase (DB)  ←→  로컬 수집기 (PC)
                                      ←→  GitHub Actions (CI)
```

| 구성 요소 | 역할 |
|----------|------|
| **Next.js (Vercel)** | 대시보드 UI, API 라우트 |
| **Supabase** | 상품/가격/수집요청 데이터 저장 |
| **로컬 수집기** | 쿠팡 포함 전체 채널 가격 수집 (PC에서 실행) |
| **GitHub Actions** | 다나와/네이버 자동 수집 (일 1회, 쿠팡 제외) |

## 채널별 수집 방식

| 채널 | 방식 | 환경 | 비고 |
|------|------|------|------|
| **쿠팡** | Playwright (headless: false) + Chrome 프로필 | 로컬 전용 | 봇 감지 우회, 사람 행동 시뮬레이션 |
| **네이버** | 네이버 쇼핑 검색 API | CI/로컬 | 카탈로그 직접 접근 불가 (캡차 차단) |
| **다나와** | Playwright (headless) | CI/로컬 | `#lowPriceCompanyArea` 기반 최저가 추출 |

## 시작하기

### 1. 환경 변수 설정

`.env.local` 파일 생성:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret
```

### 2. 설치 및 실행

```bash
npm install
npx playwright install chromium
npm run dev
```

### 3. 로컬 수집기 실행

```bash
npx tsx --watch scripts/local-collector.ts
```

- Supabase `collect_requests` 테이블을 5초마다 폴링
- 대시보드에서 "즉시 수집" 클릭 시 자동으로 수집 시작
- `--watch` 옵션으로 코드 변경 시 자동 재시작
- 쿠팡 수집 시 Chrome 창이 잠깐 열렸다 닫힘 (headless: false 필수)

### 4. 수집 필수 조건

| 조건 | 이유 |
|------|------|
| Chrome 설치 | `channel: 'chrome'`으로 실제 Chrome 사용 |
| headless: false | 쿠팡 봇 감지 우회 (headless는 Access Denied) |
| 로컬 PC 실행 | 모니터/디스플레이 환경 필요 |
| GitHub Actions 불가 | 쿠팡은 CI에서 자동 스킵 |

## 대시보드 기능

- **메인**: 채널별 최저가 요약, 전일 대비 변동, 채널 URL 링크
- **상품 관리**: 상품 등록/수정, 채널별 URL 관리
- **상품 상세**: 가격 추이 차트 (Recharts), 수집 로그
- **Export**: CSV/Excel 다운로드
- **에러 로그**: 수집 실패 이력

## DB 스키마

| 테이블 | 용도 |
|--------|------|
| `products` | 상품 정보 (이름, 채널별 URL, 활성 여부) |
| `price_logs` | 가격 수집 로그 (채널, 가격, 판매처, 수집일시) |
| `scrape_errors` | 수집 실패 로그 |
| `collect_requests` | 수집 요청 큐 (대시보드 → 로컬 수집기) |

## 수집 흐름

```
대시보드 [즉시 수집] → Supabase collect_requests (pending)
                              ↓ (5초마다 폴링)
                     로컬 수집기 (local-collector.ts)
                              ↓
                     Playwright 수집 (쿠팡 headless:false + 다나와/네이버)
                              ↓
                     price_logs 저장 → collect_requests (completed)
                              ↓ (3초마다 상태 확인)
                     대시보드 자동 갱신
```

## 프로젝트 구조

```
src/
  app/                    # Next.js App Router
    api/
      collect/            # 수집 요청 API
      prices/             # 가격 조회 API
      products/           # 상품 CRUD API
      export/             # 데이터 Export API
      errors/             # 에러 로그 API
  components/             # UI 컴포넌트
  hooks/                  # React 커스텀 훅
  scraper/
    channels/
      coupang.ts          # 쿠팡 (Playwright headless:false)
      naver.ts            # 네이버 (API 폴백)
      danawa.ts           # 다나와 (Playwright headless)
    index.ts              # 수집 오케스트레이터
    utils.ts              # 브라우저 생성, 유틸리티
  lib/
    supabase.ts           # Supabase 클라이언트
    export.ts             # CSV/Excel 변환
  types/
    database.ts           # TypeScript 타입 정의
scripts/
  collect.ts              # GitHub Actions용 수집 스크립트
  local-collector.ts      # 로컬 폴링 수집기
```
