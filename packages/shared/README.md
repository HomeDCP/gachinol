# @gachinol/shared — 공용 도메인 모델·계약

앱 3종(reporter·control-center·subscriber)과 서비스 3종(api·media-worker·ai-worker)이 공유하는
**순수 TypeScript 타입·상수·상태머신·DTO·실시간 이벤트 계약**의 단일 원천.

## 설계 원칙

- **런타임 의존성 0** — `dependencies`는 영구히 빈 상태. 순수 타입 + `as const` 상수 + 소량의 순수 함수만.
- **TS `enum` 금지** — `as const` 객체 + 파생 유니언. 값 객체와 타입을 같은 이름으로 export(선언 병합).
  상수 값은 `snake_case` 문자열 = wire format(JSON·DB 저장값 그대로).
- **지사는 코드가 아니라 데이터** — 지사명 리터럴은 어떤 타입에도 없다. 2→12→N 확장은 stations 행 추가로 끝.
  센터도 `Station`의 한 행(`kind: 'center'`).
- **모든 엔티티 관계는 브랜디드 ID 참조** — `common/id.ts`의 UUID v7 기반 브랜디드 문자열.
- **상태머신은 전이 맵이 유일한 진실** — `Record<상태, 허용 다음상태[]>` + 공용 `canTransition`.
  막다른 상태 금지: 모든 `*_failed` 상태는 (재시도)+(취소) 출구를 가진다.
- **시크릿 값은 shared 타입에 없다** — `credentialRef`/`streamKeyRef`만. 유일한 예외는 관제 전용 `LiveIngestInfo`.
- **감사 가능성** — 상태 전이는 `StatusTransitionLog`, 수정 지시 원문은 `RevisionRequest`로 기록.

## 구조

```
src/
├── index.ts            # 배럴 — 전 모듈 재수출 (사이드이펙트 금지)
├── common/             # Brand·브랜디드 ID·시간·Krw·페이지네이션·ApiError·상태머신 헬퍼
├── station/            # Station (센터+지사, 허브 앤 스포크)
├── user/               # User(role 판별 유니언)·CommunityFigure(이장·촌장·어촌계장·삼춘·부녀회장)
├── content/            # ProgramCategory 6종·ContentStatus 23종 워크플로우·Content/Scene·RevisionRequest·기자 앱 DTO
├── media/              # MediaAsset (storageKey가 원본 좌표, 서명 URL 발급은 MediaAccessUrl)
├── job/                # Job (BullMQ 계약 — JobPayloadMap으로 생산자·소비자 공유)
├── analysis/           # AiAnalysis (비전+STT/요약, generation별 이력)
├── recommendation/     # WeeklyRecommendation (센터 승인/수정 루프)
├── distribution/       # Platform·ChannelAccount(카톡채널 12개+SNS)·Publication(채널 단위 송출 상태머신)
├── live/               # LiveSession·LiveComment(외부 댓글→프롬프터)·ChatMessage(자체 채팅)
├── commerce/           # Product·Order/Payment·MediaSale(B2B)
├── weather/            # LocalWeatherForecast ('감' 기반 날씨예보 — 오늘 관찰→내일 예측→활동 제안)
├── audit/              # StatusTransitionLog (누가 언제 승인·반려·수정했는가)
├── control/            # 센터 관제 앱 합성 DTO (StationOverview·RecommendationReview 등)
├── subscriber/         # 구독자 앱 DTO (FeedItem·PlaybackInfo 등)
└── realtime/           # WS 룸 네이밍 + ServerEventPayloads/ClientEventPayloads 타입 맵
```

의존 방향(순환 금지): `common` ← 도메인 모듈 ← 합성 DTO(`control`·`subscriber`) 및 `realtime`.
도메인 모듈 간 참조는 원칙적으로 ID 타입만(예외: `Platform`·`ProgramCategory` 같은 단방향 상수 import).

## 사용

```ts
import { ContentStatus, canTransitionContent, type Content } from '@gachinol/shared';

canTransitionContent(ContentStatus.Draft, ContentStatus.Uploading); // true
```

## 명령어

```bash
pnpm typecheck   # tsc --noEmit (strict + noUncheckedIndexedAccess)
pnpm build       # dist 출력
```

## 상태

Phase 1 도메인 모델 구현 완료. 미해결 쟁점(reviewPolicy 기본값 매핑·카톡 송출 단위·라이브 인프라 등)은
설계 명세 §20 참조 — 구현 착수를 막지 않는 항목으로 관리.
