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
├── recommendations/ # 주간 콘텐츠 추천 — 결정적 랭킹·상태머신·센터 5종 + 인프로세스 큐(폴백 인라인)
├── pipeline/     # QueueEvents 소비자(★ 유일 DB 기록자) — media·analysis·distribution·recommendation 잡이벤트→상태전이
├── feed/         # 구독자 공개 피드(@Public read 3종)
└── live/         # 라이브+WebSocket — 게이트웨이·LiveSession REST·채팅(익명)·프롬프터·댓글수집(어댑터+목)
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

## 주간 콘텐츠 추천 (Weekly Recommendation — 전부 `center_operator`·`admin`)

| 엔드포인트 | 동작 |
| --- | --- |
| `POST /v1/recommendations` | 생성 트리거. body `{weekOf}`는 주중 아무 날짜 — 서버가 **그 주 월요일(Asia/Seoul)로 내림 정규화**. 형식뿐 아니라 **실존 날짜**까지 스키마가 검증(`2026-02-31`→400 `validation_failed`). 응답 `WeeklyRecommendation` |
| `GET /v1/recommendations` | 목록 `Paginated<WeeklyRecommendation>` (`weekOf` 내림차순, `status?` 필터) |
| `GET /v1/recommendations/:id` | `RecommendationReview` — items를 rank순 `ContentSummary`로 조인 |
| `POST /v1/recommendations/:id/approve` | `pending_review→approved` (바디 없음). 승인자·승인시각 기록 |
| `POST /v1/recommendations/:id/request-revision` | body `{note}` → `revision_requested` 후 **같은 tx에서 `regenerating` 자동 연쇄**(generation+1). 응답 status=`regenerating` |

- **상태머신**: shared `RECOMMENDATION_STATUS_TRANSITIONS`가 유일 원천(api에 사본 금지).
  `generating→pending_review→{approved | revision_requested→regenerating→pending_review}` 루프.
  전이는 전부 `RecommendationWorkflowService.applyHop`(CAS + `status_transition_logs`, `entityType='weekly_recommendation'`).
  범용 transition 엔드포인트는 만들지 않았다 — 각 전이의 진입점은 하나뿐.
- **랭킹 규칙(결정적 · ai-worker 재호출 없음)**: 후보 = `contents.status='published'` ∧ `published_at ∈ [weekOf 00:00 KST, +7d)`
  ∧ 같은 세대 완료 분석 존재. 정렬 = `recommendationScore DESC(null→0)` → `publishedAt DESC` → `contentId ASC`(3단 전순서라 흔들림 0).
  상위 `RECOMMENDATION_TOP_N`(기본 7) 절단, rank 1부터. `reason`은 `ai_analyses.text`(요약 첫 문장·키워드) 파생 —
  **실 ML 재랭킹 없음**(기존 점수 재사용). `highlights`는 채우지 않는다(샷 경계 ≠ 하이라이트).
- **큐 vs 인라인**: 워커는 api **인프로세스**. `REDIS_URL` 설정 시 `recommendation` 큐를 돌고
  `PipelineService`(유일 DB 기록자)가 완료를 반영한다. 미설정 시 **인라인 계산 폴백** —
  추천은 외부 HTTP 0회·순수 DB 집계라 `generating` 고착이 무가치하기 때문(송출과 다른 판단, 코드 주석 참조).
  계산 진입점은 `RecommendationRankingService.rank` 하나, 기록 진입점은 `RecommendationsService.applyGenerationResult` 하나.
- **멱등 3키**: ① `week_of` UNIQUE(주 1건 하드가드, 동시 POST는 P2002→409) ② 상태별 분기
  (`generation_failed`만 재시도 200 · `generating|regenerating`→409 "이미 생성 중"(고착 아닐 때, 아래 참조) ·
  그 외→409 "이미 있음" + `details{id,status}`)
  ③ 결과 기록의 **세대 CAS**(`where {id, generation}`) — 늦게 온 구세대 결과가 신세대를 덮지 못한다.
- **고착 복구**: `generating|regenerating`이 `RECOMMENDATION_STUCK_MS`(기본 10분)보다 오래 머물면, 같은 주차 재요청이
  `generation_failed`로 **강제 강등(system 전이, note=`생성 고착 N초 …`)한 뒤 재시도**한다. `week_of`가 unique라 대체 행을
  만들 수 없어, 잡 유실(Redis flush·재기동)·프로세스 사망·완료 처리 중 일시 오류로 진행 중에 남으면 그 주차가 API로 영구
  차단되기 때문(부팅 리컨사일은 큐에 잡이 남아 있을 때만 동작). 고착이 아니면 그대로 409.
- **재시도의 수정지시 재패킹**: 재생성이 실패한 뒤의 재시도(`generation_failed→generating`, 세대 유지)는 **미해소
  `RevisionRequest`(최신 1건)를 다시 잡에 싣는다** — 안 그러면 총평의 `[재생성 gN — 수정 지시: …]` 접두(센터가 "무엇을
  반영한 세대인지" 아는 유일 통로)가 사라지고 해소 레코드가 영구 미해소로 남는다. 해소 조건도 `from==='regenerating'`이
  아니라 **완주(`→pending_review`) 시 미해소분 전체** — 최초 생성엔 미해소 지시가 존재할 수 없어 무해하다.
- **기록 순서**: items·summary 먼저 → 전이. 관제가 `pending_review`를 관측할 땐 items가 이미 있다.
- **items 쓰기 경계 검증**: `applyGenerationResult`가 `zRecommendationItems`로 **읽기(mapper)와 같은 스키마**를 통과시킨
  뒤에만 JSONB에 기록한다. 위반 시 기록하지 않고 `generation_failed`(note=`items 계약 위반 — …`). 계약 밖 값(예: 0~1을
  벗어난 `recommendationScore` — ai-worker 응답에 강제 지점이 없다)을 영속시키면 그 주차 행이 목록·상세를 생 `ZodError`로
  영구 500으로 만들고, 고칠 API 진입점이 없다.
- **후보 0건**: 랭킹은 실패 개념 없이 `items:[]`를 돌려주고, 기록자가 `generation_failed`(note=`대상 콘텐츠 0건`)로 판정한다 —
  빈 검토 화면(승인할 게 없는 `pending_review`)을 만들지 않는다.
- **실패 사유의 유일 원천**은 `status_transition_logs.note` — shared `WeeklyRecommendation`에 `lastError`가 없어 컬럼을 만들지 않았다.
- 큐 wire는 api-내부 `recommendations/recommendation-job.ts`(워커 인프로세스라 shared 불요). shared 추가는 `GenerateRecommendationRequest` 1건뿐.
- **범위 밖**: `approved→publishing→published` 배선(승인 후 '송출'의 실체가 운영 미확정) · `discarded` 엔드포인트 ·
  주간 자동 생성 스케줄 · ai-worker 실 재랭킹 · 추천→라이브 큐시트(`live_sessions.weekly_recommendation_id` 예약 유지).

## 라이브 + WebSocket (Live)

**WS 게이트웨이** (`live.gateway.ts`, 단일 네임스페이스). 룸·이벤트는 shared `realtime/{rooms,events}.ts` 소비(재정의 금지). 각 핸들러는 try/catch→`ws-ack.ts`로 `WsAck` 직렬화(전역 `AllExceptionsFilter`는 HTTP 전용이라 우회).

| 이벤트(C→S) | 게이트 | 동작 · ack |
| --- | --- | --- |
| `live.join {liveSessionId}` | 익명 | joinable({scheduled,preparing,live,interrupted}) 검증→룸 join→프레즌스++→`live.viewer_count` 브로드캐스트. ack `LiveJoinAck{session:LiveSessionPublic, recentChat}` |
| `live.leave {liveSessionId}` | 익명 | 룸 leave→프레즌스--. ack `null` |
| `chat.send {liveSessionId,message}` | 익명(닉네임=핸드셰이크) | 룸참가·`status==='live'`·trim 비어있지않음·≤`LIVE_CHAT_MESSAGE_MAX_LEN`·토큰버킷 통과 → `ChatMessage` 영속→`chat.new` 브로드캐스트. ack `ChatMessage` |
| `prompter.join {liveSessionId}` | **JWT**: announcer·center_operator·admin | 프롬프터 룸 join. ack `PrompterJoinAck{recentComments}` |
| `control.join {}` | **JWT**: center_operator·announcer·admin | 관제 룸 join. ack `null` |

서버 emit: `live.status_changed`(전이 커밋 후 liveRoom+CONTROL_ROOM)·`live.viewer_count`·`chat.new`·`chat.moderated`·`prompter.comments`(수집 배치). 인증 핸드셰이크=`auth.token`(JwtAuthGuard 동일 검증→익명 강등), 닉네임=`auth.nickname`(재연결 시 클라 재전달).

**센터 REST** (`@Controller('live-sessions')`, `@ApiBearerAuth`, `center_operator`·`admin`; 목록/상세는 announcer도):

| 엔드포인트 | 동작 |
| --- | --- |
| `POST /v1/live-sessions` | 생성 — 불변식 `type='emergency' ⇔ scheduledAt=null`, 초기상태=`initialLiveStatus(type)`, hostStationId 생략 시 센터 |
| `GET /v1/live-sessions` · `/:id` | 목록(status·type·hostStationId 필터·offset) · 상세 |
| `GET /v1/live-sessions/:id/ingest` | `LiveIngestInfo` — **streamKey 실값이 실리는 유일 엔드포인트**(dev=`LIVE_DEV_STREAM_KEY ?? 'dev-'+id`) |
| `POST /v1/live-sessions/:id/{prepare,start,interrupt,resume,end,cancel}` | 라이프사이클 CAS(shared `LIVE_SESSION_STATUS_TRANSITIONS`)+`status_transition_logs`(entityType='live_session')+커밋후 `live.status_changed`. start=댓글수집 arm·end/cancel=disarm |
| `POST /v1/live-sessions/:id/chat/:messageId/hide` | 채팅 숨김 — `visibility=hidden`+`chat.moderated` 브로드캐스트 |

**공개 REST** (`@Controller('live')`, 전부 `@Public`): `GET /v1/live/sessions`·`/sessions/:id` → 화이트리스트 `toLiveSessionPublic`(streamKeyRef·rtmpIngestUrl·createdByUserId 구조적 차단), status∈{scheduled,preparing,live,interrupted}만(ended/canceled 404).

- **채팅=익명 공개** — 게스트 UUID v7을 `chat_messages.user_id`(FK 없음)로 저장, 닉네임=핸드셰이크. 서버 토큰버킷 레이트리밋(초과→`validation_failed`+`details.reason='rate_limited'`).
- **댓글 수집** = `CommentSourceAdapter`+**목 기본**(youtube/meta/x/threads 결정적, `fail-` 접두 throw). 실 어댑터는 기존 `YOUTUBE_*`/`META_*`/`X_*`/`THREADS_*` 키 게이트(신규 시크릿 0). `CommentCollectorService`=인프로세스·**이벤트-암드**(활성0=타이머0), `collectOnce(id)`→`comment_read` 채널 poll→정규화→`createMany(skipDuplicates)` 멱등영속→`collected` 배치 프롬프터 푸시→`prompted` 마킹(재호출 dedup). **api=유일 DB 기록자**.
- **다중 인스턴스 fan-out** = socket.io Redis 어댑터(`afterInit`에서 `REDIS_URL` 있을 때만 주입). 미설정=단일 인스턴스 프레즌스 정확·저하. 다중 인스턴스 중복 폴링 방지는 MVP 단일 인스턴스 전제.
- 신규 shared **0** — `live`·`realtime` 계약 전량 소비. Prisma 3테이블(`live_sessions`·`live_comments`·`chat_messages`).

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

채널 계정 CRUD · 주간추천 승인→송출(`publishing`) 배선 · 실 카카오/SNS 어댑터 구현 · 실 RTMP/HLS 스트리밍 인프라(현재 env 플레이스홀더) ·
라이브 종료→VOD(`vodContentId`) · SNS 댓글 실 수집 어댑터 · 커머스(라이브커머스·B2B). 커머스 도메인은 스키마·코드에 선반영하지 않았다.
