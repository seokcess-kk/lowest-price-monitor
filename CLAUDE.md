<!--
이 파일은 점진적으로 개선됩니다.
클로드가 실수하거나 의도와 다른 결과를 낼 때마다,
해당 케이스를 방지하는 규칙을 한 줄씩 추가해 주세요.
예: "API 응답 타입을 변경할 때 프론트엔드 타입도 반드시 함께 수정할 것"
-->

# 최저가 모니터링 시스템

## 개요
- 쿠팡·네이버·다나와 3개 채널의 상품 가격을 자동 수집·대시보드로 모니터링
- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4
- Supabase (DB) / GitHub Actions (수집 크론) / Bright Data Web Unlocker (차단 우회)
- 상세 아키텍처는 `README.md` 참조 — 여기에 중복 기술하지 말 것

## ⚠ Next.js 16 주의
이 버전은 학습 데이터와 API·컨벤션·파일 구조가 다를 수 있다. 라우트/서버 액션/타입 관련 코드를 쓰기 전에 `node_modules/next/dist/docs/` 내 관련 가이드를 먼저 읽고, deprecation 경고를 존중할 것.

## 빌드 & 실행
- 설치: `npm install`
- 개발 서버: `npm run dev` (http://localhost:3000)
- 빌드: `npm run build`
- 린트: `npm run lint`
- 타입체크: `npx tsc --noEmit`
- 로컬 수집 (1회): `npm run collect` — `.env.local` 자동 로드
- CI 수집: `npm run collect:ci` — 환경변수는 외부에서 주입
- 테스트: **없음** (유닛 테스트 프레임워크 미도입)

## 디렉터리 구조
- `src/app/` — Next.js App Router (페이지 + API 라우트)
  - `api/products`, `api/prices`, `api/collect`, `api/export`, `api/brightdata`, `api/errors`
  - `products/[id]` 상세, `products/manage` 상품 관리, `export` 엑셀
- `src/components/` — React 컴포넌트 (PriceCardList, PriceTable, PriceChart 등)
- `src/scraper/` — 수집 로직
  - `channels/{coupang,naver,danawa}.ts` — 채널별 파서
  - `brightdata.ts` — Web Unlocker 호출 + 사용량 카운트
  - `index.ts` — 3채널 병렬 수집 오케스트레이터
- `src/lib/` — `supabase.ts` (클라이언트), `price-utils.ts`, `export.ts`
- `src/types/database.ts` — DB/API 공용 타입 (단일 소스)
- `scripts/collect.ts` — CLI/CI 수집 엔트리
- `supabase/migrations/` — 순서대로 실행되는 SQL 마이그레이션
- `.github/workflows/collect-prices.yml` — cron + workflow_dispatch

## 도메인 용어
- **Channel**: 수집 채널. `'coupang' | 'naver' | 'danawa'` 3종 고정. 신규 추가 시 `src/types/database.ts`의 `Channel` 타입부터 손댈 것
- **store_name**: 네이버/다나와 카탈로그 내 **실제 판매처명** (G마켓, 11번가, KT알파 등). 쿠팡은 본인이 판매자이므로 항상 `null`로 둔다
- **price_logs**: 모든 수집 이력 (히스토리). 차트·Export의 원천 데이터
- **collect_requests**: "즉시 수집" 버튼이 GitHub Actions를 dispatch할 때 진행률(`progress_done/total`) 추적용 큐
- **scrape_errors**: 채널별 수집 실패 로그. 연속 3회 이상 실패 시 대시보드 경고(`FailureWarning`)
- **brightdata_usage**: Web Unlocker 호출 카운트 — 로컬 카운트 + 공식 통계 동기화
- **ChannelPrice vs PriceLog**: `ChannelPrice`는 대시보드 표시용 계산 결과 (전일 대비 change 포함), `PriceLog`는 DB row. 혼동 금지
- **Web Unlocker**: Bright Data의 차단 우회 HTTP 프록시. 3채널 모두 여기 경유한다 (Playwright/브라우저 없음)

## 코딩 규칙

### 네이밍
- 파일: React 컴포넌트 `PascalCase.tsx`, 유틸/훅 `kebab-case.ts` / `useCamelCase.ts`
- DB 컬럼/타입 필드: `snake_case` (예: `store_name`, `product_id`). 프론트 계산용 필드만 `camelCase` 허용

### API 응답 타입
- API 라우트의 응답 shape은 반드시 `src/types/database.ts`에 선언된 타입과 일치시킬 것
- API 응답 필드를 추가/변경하면 **동시에** 프론트 컴포넌트·훅도 수정. API만 바꾸고 UI를 안 고치면 타입 에러 없이도 빈 값이 렌더된다

### 스크래퍼
- 모든 채널 파서는 `ScrapeResult | null` 또는 throw 로 귀결. 반환 타입 임의 변경 금지
- DOM 파싱은 React CSS Modules 해시가 빌드마다 바뀌므로 **클래스 접두사**로만 매칭 (`product_seller_item__[^"]*` 식). 전체 해시를 하드코딩하지 말 것
- 네이버/다나와는 "최저가 판매처"를 뽑을 때 반드시 `store_name`과 같은 행에서 함께 파싱 — 가격과 스토어가 엇갈리면 안 됨
- 파서가 실패(`null`)면 상위에서 `scrape_errors`에 기록된다. 조용히 0원이나 이전 값을 반환해선 안 됨

### Next.js / React
- App Router만 사용. Pages Router 패턴(`getServerSideProps` 등) 사용 금지
- 클라이언트 컴포넌트는 파일 최상단에 `'use client';` 명시
- Supabase 서비스 롤 키는 **서버 코드에서만** (`src/lib/supabase.ts` 또는 API 라우트). 클라이언트 번들 유출 금지

### 금지 패턴
- 임시 디버그 파일(`debug-*.{js,mjs,html}`)을 루트에 남기지 말 것. 작업 끝나면 삭제
- `// TODO` 만 적고 넘어가지 말 것. 구현하거나 이슈로 이관
- 주석은 **왜**만 적고 **무엇**은 적지 말 것 (루트 지침)

## 검증 규칙 (Self-Verification)
코드 변경 후 사용자에게 "완료"를 보고하기 전에 **아래 중 해당되는 것을 직접 실행**한다. 에러가 나면 보고만 하지 말고 원인 분석 → 수정 → 재실행까지 끝낼 것.

1. **TypeScript 변경** → `npx tsc --noEmit` (빠르고 가장 먼저)
2. **Next.js 페이지/라우트 변경** → `npm run build` 로 프로덕션 빌드 성공 확인
3. **ESLint 범위 변경** → `npm run lint`
4. **스크래퍼 파서 변경** → 해당 채널 URL로 실제 HTML을 받아 파싱 결과를 수동 확인 (예: 네이버는 `product_is_lowest_price__` 마커 유일성과 가격·스토어 페어링 점검)
5. **DB 스키마 변경** → `supabase/migrations/` 에 새 파일로 추가 (기존 마이그레이션 수정 금지), 시퀀스 번호 규칙 유지
6. **UI 변경** → `npm run dev` 후 브라우저에서 골든 패스 + 엣지 케이스 확인. 브라우저 확인이 불가능한 환경이면 "UI를 직접 검증하지 못했다"고 명시 보고할 것
7. **API 응답 shape 변경** → API와 소비처(컴포넌트/훅/`export.ts` 등) 모두 업데이트 후 grep으로 옛 필드명 잔존 여부 확인

## 실행 주의
- 파괴적 git 명령(`reset --hard`, `push --force`, `branch -D` 등)은 사용자가 명시 요청하지 않는 한 금지
- `supabase/migrations/` 파일은 이미 적용된 것은 수정 금지 — 항상 새 번호로 추가
- `.env.local`은 절대 커밋하지 말 것

## 참조 문서
- 프로젝트 전체 설명·환경변수·배포 가이드: `README.md`
- 수집 워크플로우: `.github/workflows/collect-prices.yml`
- 루트 에이전트 지침 (Next.js 16 경고): `AGENTS.md`

## 변경 이력
- `2026-04-14`: 초기 작성. 솔로 프로젝트 기준이므로 팀 PR 공유 섹션은 생략
