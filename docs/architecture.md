# 아키텍처 상세

> 개요는 [CLAUDE.md](../CLAUDE.md) 참고. 이 문서는 각 구성요소의 책임과 흐름을 더 깊게 다룬다.

## 1. 도메인 6개

| 도메인 | 책임 | 주 구현 위치 |
|---|---|---|
| **Ingest (수집)** | 기자 촬영물·자막·분류 업로드 수신, 원본 저장 | `apps/reporter`, `services/api` |
| **Process (처리/편집)** | 트랜스코딩, 자동편집 오케스트레이션, 저화질 프리뷰 생성 | `services/media-worker` |
| **Analyze (AI 분석)** | 화면(비전)·텍스트(STT/자막/요약) 분석, 태깅, 주간 콘텐츠 추천 | `services/ai-worker` |
| **Distribute (송출)** | 카카오톡 채널 12개 + YouTube/FB/IG/X/Threads 다채널 송출 | `services/api` + 커넥터 |
| **Live (라이브)** | RTMP ingest→다채널 fan-out, 채널별 실시간 댓글 집계·프롬프터 | `services/api`(WS) + 라이브 인프라 |
| **Monetize (수익화)** | 라이브커머스 판매·결제, B2B 미디어 세일즈(방송3사/종편/케이블) | `services/api` + PG |

## 2. 핵심 워크플로우 — 녹화 콘텐츠 (월~금)

1. 기자가 `reporter` 앱으로 촬영 → 장면별 자막/설명 기입 → 분류 → **원본 업로드**
2. `api`가 업로드를 접수하고 오브젝트 스토리지에 원본 저장 + 작업을 **큐(BullMQ)** 에 등록
3. `media-worker`가 트랜스코딩 + **자동편집** 수행 → 저화질 프리뷰 생성
4. `ai-worker`가 화면+텍스트 분석 → 태깅/요약 저장 → **주간 콘텐츠 추천** 갱신
5. 기자가 앱에서 **저화질 프리뷰 확인 → 승인**
6. 승인 시 사전 지정된 송출처(현재: 기자 소속 **카톡채널**)로 **송출**
7. 센터 관제 앱은 (2)~(4) 결과를 보고 추천을 검토·승인/수정. 수정 입력 시 반영해 재생성.

## 3. 핵심 워크플로우 — 라이브 (토~일 / 긴급)

1. 센터에서 라이브 시작 → **RTMP ingest**
2. 다채널 **fan-out**: YouTube·FB·IG·X·Threads 동시 송출 (+ HLS로 구독자 앱 배포)
3. 각 채널의 **실시간 댓글을 수집** → `api`가 통합·정규화 → WebSocket으로 **아나운서 프롬프터**에 표시
4. 아나운서가 프롬프터를 보며 실시간 소통·진행
5. 라이브커머스: 동일 구조 + 구매 유도/이벤트 + PG 결제 연동

## 4. 데이터 저장

- **PostgreSQL**: 사용자·지사·콘텐츠 메타데이터·워크플로우 상태·주문(커머스)
- **Redis**: 큐(BullMQ)·캐시·실시간 pub/sub(댓글 집계·프리즌스)
- **오브젝트 스토리지(S3 호환)**: 영상 원본·트랜스코딩 산출물·썸네일 (로컬은 MinIO)

## 5. 실시간(WebSocket) 채널 — **구현됨** (`services/api/src/live`, socket.io)

단일 게이트웨이. 룸·이벤트는 shared `realtime/{rooms,events}.ts`가 유일 원천(재정의 금지). 각 핸들러는 `WsAck`로 응답(전역 HTTP 필터 우회, `ws-ack.ts`).

- **라이브 시청자 채팅** (구독자 앱 ↔ api) — 룸 `live:{id}`, **익명 공개**(닉네임=핸드셰이크 `auth.nickname`, 서버 토큰버킷 레이트리밋). `live.join`/`live.leave`/`chat.send`, 서버 `chat.new`·`chat.moderated`·`live.viewer_count`. `ChatMessage` 영속(게스트 UUID v7=user_id, FK 없음).
- **채널별 외부 댓글 집계 → 아나운서 프롬프터** — 룸 `prompter:{id}`, **JWT 게이트**(announcer·center_operator·admin). `CommentCollectorService`(인프로세스·이벤트-암드)가 `comment_read` 채널을 poll(어댑터+목 기본, SNS 키 게이트)→정규화 `LiveComment`(`(channel,external)` unique dedup)→`prompter.comments` 배치 푸시. api=유일 DB 기록자.
- **관제 룸** `control` (center_operator·announcer·admin) — 라이브 상태 브로드캐스트 수신. 관제 대시보드 진행률(업로드/처리/추천)은 후속(같은 `LiveBroadcaster` export 지점 재사용).
- **인증 경계**: 채팅 룸=익명(연결 거부 안 함, 권한은 룸 조인 시점 판정), 프롬프터·관제 룸=핸드셰이크 JWT(JwtAuthGuard 동일 검증). 연결 인증 성공 시 `user:{id}` 자동 join.
- **룸 네이밍**: `live:{id}` · `prompter:{id}` · `control` · `user:{id}` (shared `rooms.ts`).
- **다중 인스턴스**: socket.io Redis 어댑터(`REDIS_URL` 있을 때만) fan-out. 미설정=단일 인스턴스(프레즌스 정확). 라이브 스트리밍(RTMP/HLS)은 실 인프라 미구축 — LiveSession이 ingest/playback URL을 env 플레이스홀더로 보유.

## 6. 미정 결정 (진행하며 확정)

- 라이브 인프라: 자체 RTMP/HLS(nginx-rtmp/SRS 등) vs 매니지드(Mux, AWS IVS)
- 다채널 fan-out: 자체 relay vs 외부(Restream 류)
- 서버 사양·오토스케일 정책
- 센터 관제의 웹 콘솔 병행 여부
- 카톡 채널 vs 자체 앱 배포 전략(병행 유력)
