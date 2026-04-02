---
name: price-monitor
description: "최저가 모니터링 시스템 전체를 구축하는 오케스트레이터 스킬. 인프라 셋업, 스크래퍼 개발, 대시보드 구현, QA 검증을 순차적으로 조율한다. '최저가 모니터링 구축', '시스템 구축', '전체 빌드', 'SPEC 구현', '프로젝트 빌드' 키워드에 트리거. 반드시 이 스킬을 사용하여 전체 시스템을 빌드할 것."
---

# Price Monitor Orchestrator

최저가 모니터링 시스템의 전체 빌드를 조율하는 오케스트레이터. 4개 에이전트를 순차/병렬로 호출하여 SPEC.md의 모든 요구사항을 구현한다.

## 실행 모드: 서브 에이전트

## 에이전트 구성

| 에이전트 | subagent_type | 역할 | 스킬 | 출력 |
|---------|--------------|------|------|------|
| infra-engineer | infra-engineer | 프로젝트 셋업 + DB + CI/CD | setup-infra | 설정 파일, 타입, 마이그레이션 |
| scraper-engineer | scraper-engineer | 가격 수집기 | build-scraper | src/scraper/ |
| dashboard-engineer | dashboard-engineer | API + UI + Export | build-dashboard | src/app/, src/components/ |
| qa-inspector | qa-inspector | 통합 검증 | — | QA 리포트 |

## 워크플로우

### Phase 1: 인프라 셋업

**실행 방식:** 순차 (다른 모든 Phase의 선행 조건)

```
Agent(
  subagent_type: "infra-engineer",
  model: "opus",
  prompt: "SPEC.md를 읽고 setup-infra 스킬(/setup-infra)을 참조하여 프로젝트 인프라를 구축하라.
    1. Next.js + TypeScript 프로젝트 초기화
    2. 의존성 설치
    3. Supabase 클라이언트 설정 (src/lib/supabase.ts)
    4. DB 타입 정의 (src/types/database.ts)
    5. SQL 마이그레이션 파일 생성 (supabase/migrations/)
    6. GitHub Actions 워크플로우 작성
    7. 환경 변수 템플릿 (.env.example)
    8. .gitignore 설정
    완료 후 npm run build로 빌드 성공 확인."
)
```

**산출물 검증:**
- `npm run build` 성공
- `src/types/database.ts` 존재 + SPEC 스키마와 일치
- `src/lib/supabase.ts` 존재

### Phase 2: 스크래퍼 + 대시보드 (병렬)

**실행 방식:** 병렬 (독립 모듈, Phase 1 산출물에만 의존)

```
# 동시에 두 Agent 호출
Agent(
  subagent_type: "scraper-engineer",
  model: "opus",
  run_in_background: true,
  prompt: "build-scraper 스킬(/build-scraper)을 참조하여 가격 수집기를 구현하라.
    src/types/database.ts와 src/lib/supabase.ts를 사용한다.
    1. 공통 유틸리티 (src/scraper/utils.ts)
    2. 쿠팡 파서 (src/scraper/channels/coupang.ts)
    3. 네이버 파서 (src/scraper/channels/naver.ts)
    4. 다나와 파서 (src/scraper/channels/danawa.ts)
    5. 수집 오케스트레이터 (src/scraper/index.ts)
    6. CLI 진입점 (scripts/collect.ts)
    TypeScript 타입 에러가 없는지 확인."
)

Agent(
  subagent_type: "dashboard-engineer",
  model: "opus",
  run_in_background: true,
  prompt: "build-dashboard 스킬(/build-dashboard)을 참조하여 대시보드를 구현하라.
    src/types/database.ts와 src/lib/supabase.ts를 사용한다.
    1. API 라우트 8개 (products CRUD, prices 조회, collect 트리거, export)
    2. 공유 컴포넌트 (PriceTable, PriceChart, ProductForm 등)
    3. 데이터 페칭 훅
    4. 메인 페이지 (최저가 요약)
    5. 상품 상세 페이지 (가격 추이 차트)
    6. 상품 관리 페이지
    7. Export 페이지
    8. 레이아웃 + 네비게이션
    npm run build로 빌드 성공 확인."
)
```

**산출물 검증:**
- 스크래퍼: `src/scraper/` 디렉토리에 채널별 파서 + 오케스트레이터 존재
- 대시보드: `npm run build` 성공, 4개 페이지 + 8개 API 라우트 존재

### Phase 3: QA 검증

**실행 방식:** 순차 (Phase 2 완료 후)

```
Agent(
  subagent_type: "qa-inspector",
  model: "opus",
  prompt: "SPEC.md와 전체 코드를 읽고 통합 정합성을 검증하라.
    1. API 응답 shape ↔ 프론트 훅 타입 교차 비교
    2. 라우팅 경로 ↔ 링크/네비게이션 경로 매칭
    3. DB 스키마 → API → UI 데이터 흐름 정합성
    4. 스크래퍼 출력 → DB 저장 shape 일치
    5. SPEC.md 대비 구현 완성도 체크
    결과를 _workspace/qa_report.md에 저장.
    FAIL 항목이 있으면 파일:라인 + 수정 방향을 구체적으로 명시."
)
```

**QA 결과 처리:**
- FAIL 항목이 있으면: 해당 에이전트를 재호출하여 수정 (최대 1회)
- 재수정 후에도 FAIL이면: 사용자에게 리포트를 보여주고 수동 판단 요청

### Phase 4: 최종 검증 및 정리

1. `npm run build` 최종 확인
2. `_workspace/` 디렉토리 보존
3. 사용자에게 결과 요약:
   - 생성된 파일 목록
   - 빌드 상태
   - QA 결과 요약
   - 다음 단계 안내 (Supabase 프로젝트 생성, 환경 변수 설정, Vercel 배포)

## 데이터 흐름

```
[Phase 1: infra-engineer]
  → package.json, tsconfig, types, supabase client, migrations, github actions
       │
       ├──→ [Phase 2a: scraper-engineer] → src/scraper/
       │
       ├──→ [Phase 2b: dashboard-engineer] → src/app/, src/components/
       │
       └──→ [Phase 3: qa-inspector] → _workspace/qa_report.md
                │
                └──→ (FAIL 시) 해당 에이전트 재호출 → 수정
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| Phase 1 빌드 실패 | 에러 로그 분석 후 infra-engineer 재호출 (1회) |
| Phase 2 에이전트 실패 | 1회 재시도, 재실패 시 사용자에게 알림 |
| Phase 2 빌드 실패 | 에러 로그와 함께 해당 에이전트 재호출 |
| QA FAIL 발견 | 해당 모듈 에이전트 재호출로 수정 (1회) |
| 재수정 후에도 FAIL | 사용자에게 리포트 제시, 수동 판단 요청 |

## 테스트 시나리오

### 정상 흐름
1. Phase 1: infra-engineer가 프로젝트 초기화 + DB 스키마 생성 → 빌드 성공
2. Phase 2: scraper-engineer와 dashboard-engineer가 병렬로 구현
3. Phase 3: qa-inspector가 검증 → 모든 항목 PASS
4. Phase 4: 최종 빌드 성공, 사용자에게 결과 보고
5. 예상 결과: 완전한 최저가 모니터링 시스템 코드베이스

### 에러 흐름
1. Phase 2에서 dashboard-engineer 빌드 실패
2. 에러 로그 수집 → dashboard-engineer 재호출 (에러 내용 포함)
3. 재빌드 성공
4. Phase 3 QA에서 API 응답 shape 불일치 FAIL 1건 발견
5. dashboard-engineer 재호출하여 수정
6. 재검증 PASS
7. 사용자에게 "1건 수정 후 완료" 보고
