# services/api — 메인 API 서버

**NestJS 11 + TypeScript + Prisma 6(PostgreSQL)**. 인증·사용자·지사·콘텐츠 워크플로우의 중심.
타입 원천은 `@gachinol/shared` 하나 — wire의 키는 camelCase, 열거 값은 snake_case.

## 요구사항

- Node 24 (`.nvmrc`) · pnpm 8+ · Docker (로컬 Postgres)

## 시작하기

```bash
# 리포 루트에서
pnpm infra:up                          # Postgres·Redis·MinIO 기동
cp .env.example .env                   # JWT_ACCESS_SECRET/JWT_REFRESH_SECRET(각 32자+, 서로 다르게),
                                       # SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD 채우기
                                       # 루트 .env를 api가 직접 읽는다 (Nest envFilePath +
                                       # prisma 스크립트의 scripts/prisma-with-env.mjs 래퍼).
                                       # services/api/.env를 두면 그쪽이 루트보다 우선.
pnpm install
pnpm --filter @gachinol/shared build   # shared dist(CJS) 선행 빌드
pnpm --filter @gachinol/api prisma:migrate
pnpm --filter @gachinol/api prisma:seed
pnpm --filter @gachinol/api dev        # http://localhost:4000 · Swagger /docs
```

## 모듈 지도

```
src/
├── config/    # 환경변수 zod 검증(fail-fast) · REVIEW_POLICY_DEFAULTS
├── common/    # newId(uuid v7) · zod 헬퍼 · DomainException · AllExceptionsFilter · 데코레이터 · 페이지네이션
├── health/    # GET /health/liveness · /health/readiness (terminus — 도메인 계약 밖 유일 예외)
├── prisma/    # PrismaService (@Global)
├── auth/      # 로그인 · JWT 발급/회전 · 가드(JwtAuthGuard→RolesGuard) · argon2id
├── users/     # 계정 관리 (admin) · row→shared User 매퍼
├── stations/     # 지사 CRUD + 상태 전이 (dormant→operating 부활)
├── contents/     # 초안 CRUD + ContentWorkflowService(★ 전이 단일 관문) + DistributionOrchestrator·PublicationsController
├── media/·queue/ # S3 presign·MediaAssets · BullMQ 미디어 큐 생산자
├── analysis/     # ai-worker HTTP 소비 + ai_analyses 기록 (analyzing 홉)
├── distribution/ # 다채널 송출 코어 — 채널·Publication·큐·카카오 어댑터(목 기본) + 인프로세스 송출 워커
├── pipeline/     # QueueEvents 소비자(★ 유일 DB 기록자) — media·analysis·distribution 잡이벤트→상태전이
└── feed/         # 구독자 공개 피드(@Public read 3종)
```

## 인증

- **비밀번호**: argon2id (`argon2.options.ts` 상수 — 서버 사양 확정 시 그 파일만 조정).
- **JWT**: access 15분(상태 비저장) / refresh 14일 **회전식** — 1회 사용 후 폐기.
  - 폐기된 refresh **재사용 탐지** 시 해당 세션 계보(family) 전체 무효화 (탈취 대응).
  - 다기기: 기기별 로그인 = 기기별 family. 로그아웃은 해당 family만 폐기.
  - DB에는 sha256 해시만 저장 (원문·시크릿 저장 금지).
- 가드: 전역 `JwtAuthGuard`(@Public 제외 Bearer 필수, DB에서 사용자 로드 — 정지 계정 즉시 차단) →
  `RolesGuard`(@Roles 대조, **admin은 수퍼롤**). 소유권 검증은 서비스 계층.

## 에러 규약 — shared `ApiError` 단일화 (봉투 래핑 금지)

| code                 | HTTP | 의미                                                                      |
| -------------------- | ---- | ------------------------------------------------------------------------- |
| `validation_failed`  | 400  | zod 검증 실패 (details.issues)                                            |
| `unauthorized`       | 401  | 인증 실패 (로그인 실패 3종 동일 메시지 — 계정 열거 방지)                  |
| `forbidden`          | 403  | role·소유권·정책 가드 위반                                                |
| `not_found`          | 404  | 대상 부재                                                                 |
| `conflict`           | 409  | unique 충돌 · **CAS 동시 전이 경합**(재조회 후 재시도) · 비허용 상태 수정 |
| `invalid_transition` | 409  | 상태머신 규칙 위반 — details `{ from, to, allowed }`                      |
| `internal`           | 500  | 그 외 (스택은 로그로만)                                                   |

## 콘텐츠 전이 엔드포인트 (§ 전이 규칙은 **shared가 유일한 진실** — api에 사본 금지)

| 엔드포인트                               | 동작                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v1/contents/:id/approve`          | 기자: `reporter_approved` → `afterReporterApproval(reviewPolicy)` **같은 트랜잭션 자동 연쇄**(로그 2건, 2건째 system) / 센터: `center_approved` (publishing 자동 연쇄 없음 — Distribute 단계 몫) |
| `POST /v1/contents/:id/request-revision` | `revision_requested` + RevisionRequest 생성 **동일 트랜잭션** (이 경로로만 가능)                                                                                                                 |
| `POST /v1/contents/:id/reject`           | `rejected` [종결] — 사유 필수                                                                                                                                                                    |
| `POST /v1/contents/:id/cancel`           | `canceled` [종결] — 전이 맵상 가능한 모든 상태에서                                                                                                                                               |
| `POST /v1/contents/:id/retry`            | `CONTENT_RETRY_TARGET[from]` — 기자는 `upload_failed`만. Job 재큐는 큐 단계 훅(TODO)                                                                                                             |
| `POST /v1/contents/:id/transitions`      | 범용 (admin·center_operator) — 워커 부재 기간 수동 진행·운영 복구. §11-4 정책 가드 동일 적용                                                                                                     |
| `GET /v1/contents/:id/transition-logs`   | 감사 이력 (최신순)                                                                                                                                                                               |

모든 전이는 `ContentWorkflowService`(단일 관문)를 경유: 정책 가드(origin 분기·담당 기자) →
`canTransitionContent` → 트랜잭션 내 **낙관적 CAS**(`updateMany where status=from`, affected 0 → 409 conflict) →
상태별 효과(`published`→publishedAt, `regenerating`→generation+1) → `StatusTransitionLog`.

지사도 동일 골격(`STATION_STATUS_TRANSITIONS`): `POST /v1/stations/:id/transitions` —
`dormant→operating`이 MVP "애월·제주시 부활"의 실체.

## 다채널 송출 (Distribute — 카카오 우선, 전부 `center_operator`·`admin`)

| 엔드포인트 | 동작 |
| --- | --- |
| `POST /v1/contents/:id/distribute` | `center_approved`만 — `center_approved→publishing` CAS(트리거 멱등 1관문) + 대상 채널별 `queued` Publication 생성 → 커밋 후 `distribution` 큐 인큐. body `{channelAccountIds?}` override(생략 시 서버 해석). 응답 `Publication[]` |
| `GET /v1/contents/:id/publications` | 채널별 송출 상태(최신순) |
| `POST /v1/publications/:id/retry` | 채널 단위 재시도 — `failed→queued` 재큐(+content `publish_failed→publishing`) |
| `POST /v1/publications/:id/retract` | 회수 — `published→retracted`(목 어댑터 성공). content 상태 무변 |

- **송출 워커 = api 인프로세스**(analysis 홉 동형). `REDIS_URL` 설정 시 `DISTRIBUTION_WORKER`가 큐를 소비해
  카카오 어댑터로 송출하고, `PipelineService`(유일 DB 기록자)가 `Publication`·content 전이를 기록한다.
  Redis 미설정 시 우아한 저하 — `queued` Publication만 생성하고 인큐는 생략.
- **어댑터 = 카카오 목이 배포 기본**(결정적 가짜 external ID/URL, 외부 네트워크 0). `KAKAO_REST_API_KEY && KAKAO_CHANNEL_ADMIN_KEY`
  둘 다 설정 시에만 실 `KakaoRealAdapter` 주입(현재 스켈레톤). `externalChannelId` `fail-` 접두는 결정적 실패(테스트 제어).
- **채널 부분실패 = `job.returnvalue` 데이터**(throw 아님) — 잡 throw면 성공 채널까지 재송출되므로. 채널 단위 복구는 retry 엔드포인트.
- **대상 채널 해석**: body override > `content.targetChannelAccountIds` > 지사 `connected` kakao(`vod_publish`). 0건 → 409.
- **멱등 3키**: ① content CAS(distribute 1승리) ② `(content,channel)` 활성 부분 유니크 ③ 잡 재수신 시 Publication 상태 CAS no-op.
- 전이 규칙 원천: content=shared `CONTENT_STATUS_TRANSITIONS`, Publication=shared `PUBLICATION_STATUS_TRANSITIONS`(api에 사본 금지).
- 큐 wire는 api-내부 `distribution/distribution-job.ts`(워커 인프로세스라 shared 불요). shared 추가는 `DistributeContentRequest` DTO 1건뿐.

## Swagger

비프로덕션에서만 `/docs` (JSON `/docs-json`). health 2종만 terminus 표준 응답(도메인 계약 밖 유일 예외).

## 테스트

```bash
pnpm --filter @gachinol/api test       # 단위 — DB 불요(Prisma mock), 항상 실행
pnpm --filter @gachinol/api test:e2e   # E2E — DB 프로브(2s) 후 migrate deploy+시드 자동.
                                       # DB 없으면 DB 의존 스위트는 skip으로 "녹색" 종료
```

- E2E는 **전용 테스트 DB**를 쓴다 — 기본 `gachinol_test` (없으면 globalSetup이 생성).
  스위트마다 TRUNCATE CASCADE를 실행하므로 개발 DB(`gachinol`)와 절대 공유 금지 —
  DB 이름에 `test`가 없으면 안전장치가 실행을 거부한다(스위트 skip).
  다른 테스트 DB를 쓰려면 `DATABASE_URL`을 export(이름에 `test` 포함 필수).

## 결정 기록

- **Prisma 6, enum은 text**: enum성 컬럼은 shared snake_case 문자열 그대로 저장 — 상태 추가 시 DDL 불요, 검증은 앱 경계(zod+상태머신). Prisma enum·CHECK 금지.
- **ID는 앱 발급 UUID v7**: 시간순 정렬·커서 겸용, 트랜잭션 내 선참조 가능 (DB default 미사용).
- **zod + nestjs-zod**: 스키마가 값이므로 `satisfies ZodSchemaOf<Shared계약>`로 정합을 tsc가 강제 — class-validator 재작성 드리프트 회피.
- **shared는 dist(CJS) 소비**: shared에 런타임 순수 함수가 있어 JS 산출물 필수. Expo 앱은 `react-native` 필드로 소스 소비.
- **passport 미도입**: `@nestjs/jwt` + 자체 가드로 충분 (의존 축소).
- **refresh는 테이블(회전+family)**: 다기기 현실 대응 + 재사용 탐지는 지금 넣어야 싼 구조 결정.
- **nestjs-zod×swagger 11.4 우회**: `patchNestJsSwagger`가 요구하는 SchemaObjectFactory를 절대 경로로 로드해 주입 (`src/setup-app.ts` 주석 참조).

## 이번 단계 범위 밖 (다음 단계)

댓글 수집 · SNS 확장(YouTube/Meta/X/Threads 어댑터 — 레지스트리에 platform 추가) · 채널 계정 CRUD ·
`reporter_only` 자동 송출 후킹 · 실 카카오 어댑터 구현 · WebSocket(라이브·프롬프터). 커머스·라이브 도메인은 스키마·코드에 선반영하지 않았다.
