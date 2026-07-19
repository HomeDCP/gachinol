# Gachinol · 제주 마을방송국 통합 플랫폼

제주도 **로컬 마을방송국 12개 지사**와 이를 총괄하는 **제주방송센터**를 하나로 묶어,
촬영 · 자동편집 · 다채널 송출 · 라이브 · 시청 · 수익화까지 잇는 방송 플랫폼입니다.

> 프로젝트의 배경·비전·아키텍처 전체는 [`CLAUDE.md`](./CLAUDE.md)에 정리되어 있습니다.

## 구성

- **앱 3종** (React Native + Expo, iOS/Android)
  - `apps/reporter` — 기자 앱 (촬영·편집·업로드·미리보기 승인)
  - `apps/control-center` — 센터 관제 앱 (자동 분석·콘텐츠 추천·송출 관제·댓글 프롬프터)
  - `apps/subscriber` — 구독자 앱 (시청·라이브 참여·채팅)
- **서비스**
  - `services/api` — NestJS 메인 API (인증·콘텐츠·워크플로우·실시간)
  - `services/media-worker` — FFmpeg 트랜스코딩·자동편집·프리뷰
  - `services/ai-worker` — Python/FastAPI 화면+텍스트 분석·콘텐츠 추천
- **패키지**: `packages/shared`(공용 타입) · `packages/ui` · `packages/config`
- **인프라**: `infra/` (docker-compose·배포)

## 기술 스택

React Native(Expo) · NestJS · Python(FastAPI) · PostgreSQL · Redis · S3 호환 스토리지 · FFmpeg
· pnpm workspaces + Turborepo · Node 24

## 시작하기

```bash
# 사전: Node 24 (nvm use), pnpm 8+
pnpm install
cp .env.example .env      # 값 채우기 (시크릿은 커밋 금지)
pnpm dev                  # 전체 dev
```

개별 앱/서비스 실행법은 각 디렉터리의 README를 참고하세요. (스캐폴딩 진행에 따라 채워집니다.)

## 문서

- [CLAUDE.md](./CLAUDE.md) — 프로젝트 기준 문서 (비전·아키텍처·컨벤션)
- [docs/architecture.md](./docs/architecture.md) — 아키텍처 상세
- [docs/ROADMAP.md](./docs/ROADMAP.md) — 단계별 로드맵

## 라이선스

Private / Proprietary — 무단 배포 금지.
