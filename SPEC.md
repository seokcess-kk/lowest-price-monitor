# 최저가 모니터링 시스템 — Phase 1 기획서

## 1. 목적

판매 중인 상품의 시장 최저가를 일 단위로 수집·기록하여, 가격 변동을 추적하고 기간별 데이터를 추출할 수 있는 시스템을 구축한다.

## 2. 시스템 구성

```
GitHub Actions (수집 스케줄러)
    ↓ 매일 1회 자동 / 수동 트리거
Scraper (Node.js + Playwright)
    ↓ 쿠팡·네이버·다나와 가격 파싱
Supabase (PostgreSQL)
    ↓ 가격 이력 누적 저장
Vercel (Next.js 대시보드)
    → 조회 / 관리 / Export
```

## 3. 수집 채널별 스펙

| 채널 | 입력 | 수집 항목 | 수집 방식 |
|------|------|-----------|-----------|
| 쿠팡 | 상품 URL | 가격 | Playwright (헤드리스 브라우저) |
| 네이버 | 상품 URL | 최저가, 스토어명 | 가격비교 페이지 파싱 |
| 다나와 | 상품 URL | 최저가, 스토어명 | 가격비교 테이블 파싱 |

## 4. 데이터 구조

### products (상품 마스터)

| 필드 | 타입 | 설명 |
|------|------|------|
| id | uuid | PK |
| name | text | 상품명 |
| coupang_url | text | 쿠팡 URL (nullable) |
| naver_url | text | 네이버 URL (nullable) |
| danawa_url | text | 다나와 URL (nullable) |
| created_at | timestamp | 등록일 |
| is_active | boolean | 활성 여부 |

### price_logs (가격 이력)

| 필드 | 타입 | 설명 |
|------|------|------|
| id | uuid | PK |
| product_id | uuid | FK → products |
| channel | text | coupang / naver / danawa |
| price | integer | 최저가 (원) |
| store_name | text | 판매 스토어명 (쿠팡은 null) |
| collected_at | timestamp | 수집 시각 |
| is_manual | boolean | 수동 수집 여부 |

## 5. 대시보드 화면

### 5-1. 메인 — 현재 최저가 요약

- 상품별 행, 채널별 열로 현재 최저가 테이블 표시
- 전일 대비 변동 표시 (▲▼ + 금액)
- 수동 수집 버튼 (전체 즉시 수집)

### 5-2. 상품 상세

- 채널별 가격 추이 라인 차트 (기간 선택 가능)
- 해당 상품 최근 수집 로그 테이블

### 5-3. 상품 관리

- 상품 등록: 상품명 + 채널별 URL 입력
- 상품 수정 / 비활성화

### 5-4. Export

- 기간 선택 (시작일 ~ 종료일)
- 상품 선택 (전체 또는 개별)
- CSV 또는 Excel 다운로드
- Export 항목: 날짜, 상품명, 채널, 최저가, 스토어명

## 6. 수집 스케줄

| 구분 | 방식 | 트리거 |
|------|------|--------|
| 자동 | GitHub Actions cron | 매일 09:00 KST |
| 수동 | GitHub Actions workflow_dispatch | 대시보드 버튼 클릭 → API 호출 |

- 수집 실패 시 해당 채널 에러 로그 기록, 나머지 채널은 정상 진행
- 연속 3회 실패 시 대시보드에 경고 표시

## 7. 기술 스택

| 영역 | 기술 |
|------|------|
| 스크래퍼 | Node.js + Playwright |
| 스케줄러 | GitHub Actions |
| DB | Supabase (PostgreSQL) |
| 프론트엔드 | Next.js + Tailwind CSS |
| 차트 | Recharts |
| 호스팅 | Vercel |
| Export | SheetJS (xlsx) |

## 8. Phase 2 예정

- 보장금액 계산 로직 (기준가, 보장 비율 설정)
- 텔레그램 봇 연동 (자동 알림 + 커맨드 조회)
