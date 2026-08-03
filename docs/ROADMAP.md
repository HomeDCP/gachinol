# 로드맵

단계는 순서 제안이며 상황에 따라 조정한다. 각 단계는 "한 바퀴 도는 것"을 우선한다.

## 🔄 웹 피벗 트랙 W0~W4 (2026-08-04 확정 — 현재 최우선, 상세는 [plan/08-rollout-transition.md](plan/08-rollout-transition.md))

> 네이티브 3앱 → **웹앱 3종 + 통합 쉘 앱** 전환(승인 완료). 아래 Phase 0~7의 기존 산출물은 웹 형태로 승계되며,
> 네이티브 트랙은 동결. DoD·선행조건·게이트의 정본은 plan/08 §A(여기는 요약만).

- [ ] **W0. 기반** — 도메인·Cloudflare 존/Tunnel, api CORS+쿠키 인증, R2/MinIO CORS, nginx `web`.
      선행: 사용자 결정 2건(도메인·노출 방식) + 05 §G 운전자금 게이트
- [ ] **W1. 구독자 웹** (최우선) — Expo Web 활성화·hls.js·OG/`go.` 공유 링크·카카오 인앱 실측·계측 파이프라인·어르신 패널 1차.
      기술 런칭 = W1 DoD, **대외 런칭(카톡 공지) = 시드 콘텐츠 6건 게이트 별도**
- [ ] **W2. 기자·관제 웹** — 웹 업로더 어댑터·촬영 input capture·주민 임시 업로드 링크·공개 렌디션 캐시 서빙·라이브커머스 링크아웃·미성년자 승인 게이트
- [ ] **W3. 쉘·PWA** — PWA 3종 → Android TWA → iOS 통합 쉘 심사(스토어 계정은 8주 전 개설)
- [ ] **W4. 정리** — 네이티브 트랙 종료 선언·문서/CI 정리·웹 E2E 필수 게이트화
- 병렬 트랙: **T-AI**(실 STT·비전 주입, auto_edit — W 게이트 비의존) · 커머스 2단계(GMV 트리거 시)

## Phase 0 — 기초 세팅 ✅ (현재)

- [x] 모노레포 구조 (pnpm + Turborepo)
- [x] 공통 설정 (.gitignore, tsconfig.base, prettier, editorconfig, .env.example)
- [x] CLAUDE.md · README · docs
- [x] git 초기화 + GitHub 비공개 레포

## Phase 1 — 공용 계약 & 로컬 개발환경

- [ ] `packages/shared`: 도메인 모델·타입 정의 (User, Station(지사), Content, Job, WorkflowState, Comment)
- [ ] `packages/config`: eslint/tsconfig/prettier 공유 프리셋
- [ ] `infra/docker`: docker-compose (Postgres · Redis · MinIO) 로컬 원클릭 기동

## Phase 2 — 메인 API 골격

- [ ] `services/api` NestJS 스캐폴딩
- [ ] 인증(JWT) · 사용자/지사 관리
- [ ] 콘텐츠 CRUD + 업로드 접수 + 큐(BullMQ) 등록
- [ ] 워크플로우 상태머신 (업로드→처리→분석→승인→송출)

## Phase 3 — 기자 앱 MVP

- [ ] `apps/reporter` Expo 스캐폴딩
- [ ] 촬영 · 간단 편집 · 장면별 자막/설명 · 분류 · 업로드
- [ ] 저화질 프리뷰 확인 → 승인 플로우

## Phase 4 — 처리·분석 파이프라인

- [ ] `services/media-worker`: FFmpeg 트랜스코딩·프리뷰
- [ ] `services/ai-worker`: 화면+텍스트 분석·태깅·주간 추천
  - [x] 주간 추천 **api 백엔드** — `weekly_recommendations` + 결정적 랭킹(기존 `recommendationScore` 재사용) +
        상태머신(생성→검토→승인/수정재생성) + 센터 엔드포인트 5종. ai-worker 실 재랭킹은 미착수
- [x] `apps/control-center`: 추천 검토·승인/수정 대시보드 — 주간추천 탭 실배선(목록·상세·승인/수정요청·10s 폴링).
      승인→송출(publishing) 배선과 주간 자동 생성 스케줄은 후속

## Phase 5 — 송출 & 구독자

- [ ] 카카오톡 채널 송출 연동 (1차 배포 창구)
- [ ] `apps/subscriber`: 지사 콘텐츠 시청
- [ ] SNS 다채널 송출 (YouTube → Meta → X → Threads)

## Phase 6 — 라이브 & 커머스

- [ ] RTMP ingest + HLS 배포 + 다채널 fan-out
- [ ] 채널별 댓글 집계 → 아나운서 프롬프터
- [ ] 구독자 앱 실시간 채팅
- [ ] 라이브커머스 + PG 결제

## Phase 7 — 수익화 & 운영

- [ ] B2B 미디어 세일즈(방송3사·종편·케이블) 자료 관리·판매
- [ ] 지역특화 날씨예보 포맷 정형화
- [ ] 지사 확장(2 → 12) 온보딩 도구

---

### MVP 최소 한 바퀴 (추천 스타트)

휴무 중인 **애월·제주시 2개 지사 부활**을 목표로:
`기자 앱 업로드 → api 접수/저장 → 카톡채널 송출 → 구독자 시청` 파이프라인을 가장 얇게 먼저 완성.
(Phase 1 → 2(축소) → 3(축소) → 5(카카오만) 순으로 얇게.)
