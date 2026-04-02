---
name: setup-infra
description: "최저가 모니터링 시스템의 인프라를 구축하는 스킬. Next.js 프로젝트 초기화, Supabase DB 스키마 마이그레이션, GitHub Actions 워크플로우 생성, 환경 변수 설정. '프로젝트 셋업', '초기화', 'DB 스키마', 'GitHub Actions', '마이그레이션' 키워드에 트리거."
---

# Setup Infra — 인프라 구축 스킬

최저가 모니터링 시스템의 기반 인프라를 구축한다.

## 워크플로우

### Step 1: 프로젝트 초기화

Next.js 프로젝트를 생성하고 의존성을 설치한다.

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
```

추가 패키지 설치:
```bash
npm install @supabase/supabase-js recharts xlsx playwright
npm install -D @types/node tsx
```

### Step 2: 설정 파일

**`.env.example`** 생성:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GITHUB_TOKEN=your-github-token
```

**`.gitignore`**에 추가:
```
.env
.env.local
```

### Step 3: Supabase 클라이언트

`src/lib/supabase.ts`에 서버/클라이언트 분리된 Supabase 클라이언트를 구현한다:
- `createClient()`: 브라우저용 (ANON_KEY)
- `createServiceClient()`: 서버 전용 (SERVICE_ROLE_KEY) — 스크래퍼, API 라우트용

### Step 4: 타입 정의

`src/types/database.ts`에 DB 스키마에 대응하는 TypeScript 타입을 정의한다:
- `Product` 인터페이스
- `PriceLog` 인터페이스
- `Channel` 타입: `'coupang' | 'naver' | 'danawa'`
- `PriceWithChange` (메인 페이지 표시용, 전일 대비 변동 포함)

### Step 5: DB 마이그레이션

`supabase/migrations/001_init.sql` 생성:
- products 테이블 (SPEC.md 참조)
- price_logs 테이블 (SPEC.md 참조)
- 인덱스: (product_id, collected_at DESC), (product_id, channel, collected_at DESC)
- RLS 정책은 Phase 1에서는 비활성 (서비스 롤 키 사용)

### Step 6: GitHub Actions

`.github/workflows/collect-prices.yml` 생성:
- cron: `'0 0 * * *'` (매일 00:00 UTC = 09:00 KST)
- workflow_dispatch (수동 트리거)
- Node.js 20 설정
- Playwright 설치
- `npx tsx scripts/collect.ts` 실행
- 환경 변수: secrets에서 주입

## 산출물 검증
- `npm run build`가 에러 없이 완료되는지 확인
- 타입 정의가 SPEC.md의 데이터 구조와 1:1 매핑되는지 확인
- 마이그레이션 SQL이 문법적으로 올바른지 확인
