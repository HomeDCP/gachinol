# apps/control-center — 센터 관제 앱 (Expo)

제주방송센터 운영자(`center_operator`)·관리자(`admin`)가 쓰는 **React Native (Expo)** 관제 콘솔.
(대시보드 성격상 향후 웹 콘솔 병행 유력 — CLAUDE.md §4)

## 역할 (백엔드 실존 기능만)

- **검토 보드**: 12개 지사 업로드물을 상태·지사·분류로 필터해 최신순 조회 (센터는 전 지사 횡단)
- **콘텐츠 상세**: 저화질 프리뷰 재생 + AI 분석(vision/text) + 장면·수정요청·전이 이력
- **센터 결정**: `awaiting_center_review` 콘텐츠에 대해 **승인 / 수정요청 / 반려**
- **실패 재시도**: 실패 6종(`*_failed`) 재시도 (목적지는 shared `CONTENT_RETRY_TARGET`)
- **지사 로스터**: 12지사 read-only 목록 → 행 탭 시 해당 지사로 보드 딥링크

## 유보 (백엔드 부재 — 플레이스홀더 화면만)

- **주간 추천**: `WeeklyRecommendation`/`RecommendationReview` 컨트롤러 부재
- **라이브 관제 · 댓글 프롬프터**: Live 세션·댓글 WebSocket 부재

`StationOverview` 집계·`JobListQuery`/jobs·subscriber 피드는 엔드포인트가 없어 **소비하지 않는다**
(집계·목록을 지어내지 않음).

## 아키텍처 (reporter 검증 패턴을 센터용으로 동형 이식)

- **API 클라이언트** (`src/api/client.ts`): refresh **single-flight**, 401 1회 재시도, 선제 refresh(30s 스큐),
  refresh 401/403 → 세션 종료 / 5xx·네트워크 예외 → 토큰 보존(오프라인 로그아웃 방지). reporter와 바이트 동일.
- **토큰 저장** (`src/auth/token-store.ts`): refresh만 SecureStore 영속, access는 메모리 전용.
- **role 게이트** (`src/auth/role.ts`): `isCenterConsoleUser`(center_operator·admin만). 비센터 로그인은
  best-effort 서버 logout → clear → 안내 토스트로 차단(refresh family 방치 금지).
- **라우팅**: expo-router `(auth)`/`(app)` 게이트 + Tabs 4개(검토·지사·추천·라이브) + `contents/[id]` Stack-over-Tabs.
- **상태 관리**: TanStack Query (queries staleTime 30s·4xx no-retry / mutations retry:0·낙관적 업데이트 금지).
- **폴링**: 상세 화면 포커스 중 자동 진행 상태에서 15s refetch (WS 미도입 MVP 대안).

`services/api`·`packages/shared`는 **무변경**(기존 계약 전부 소비). 공통 인프라(client·token-store·query·ui)는
reporter와 중복이나 지금은 앱 내 복제 — `packages/app-core`·`packages/ui` 승격은 별도 과제.

## 개발

```bash
# API 선행 기동 + apps/control-center/.env에 EXPO_PUBLIC_API_URL 설정
pnpm --filter @gachinol/control-center dev        # Expo dev 서버 (Expo Go)
pnpm --filter @gachinol/control-center test       # jest-expo 단위 테스트
pnpm --filter @gachinol/control-center typecheck  # shared dist 선행 빌드 필요
pnpm --filter @gachinol/control-center build       # expo export (iOS/Android 번들 스모크)
pnpm --filter @gachinol/control-center doctor      # expo-doctor
```

### 환경변수

`EXPO_PUBLIC_API_URL`만 사용(번들 인라인 공개 값 — 시크릿 금지). Expo는 루트 `.env`를 읽지 않으므로
`apps/control-center/.env`(gitignore)에 설정한다. 실기기는 개발 머신 LAN IP.

## 소비 엔드포인트 (실 컨트롤러 대조)

| 화면                      | 엔드포인트                                                   | @Roles                           |
| ------------------------- | ------------------------------------------------------------ | -------------------------------- |
| 로그인/refresh/logout/me  | `/auth/*`                                                    | @Public·인증                     |
| 검토 보드                 | `GET /contents` (status·category·stationId)                  | reporter, center_operator        |
| 상세                      | `GET /contents/:id`                                          | reporter, center_operator        |
| 승인/수정요청/반려/재시도 | `POST /contents/:id/{approve,request-revision,reject,retry}` | reporter, center_operator        |
| 전이 이력                 | `GET /contents/:id/transition-logs`                          | reporter, center_operator        |
| 프리뷰 재생               | `GET /media-assets/:id/url`                                  | reporter, center_operator, admin |
| 지사 목록/단건            | `GET /stations`·`/stations/:id`                              | 인증                             |

## 미노출(실존 권한이나 스코프 외 — notes)

- `POST /contents/:id/cancel` — `awaiting_center_review`에 canceled 출구 없음
- `POST /contents/:id/transitions` — 범용 수동 전이(운영 도구 후속)
- `PATCH /contents/:id` — 송출처(`channel_accounts`) 미시드로 선택 UI 못 채움
- `POST /stations/:id/transitions` — 지사 부활(read-only 스코프 밖)
