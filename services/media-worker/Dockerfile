# syntax=docker/dockerfile:1.7
# media-worker — BullMQ + FFmpeg 트랜스코딩·프리뷰·썸네일 워커 (DB·API토큰 무접근, S3만).
# 빌드 컨텍스트 = 리포 루트 (pnpm 워크스페이스 전체 매니페스트 필요):
#   docker build -f services/media-worker/Dockerfile -t gachinol-media-worker .
# glibc(bookworm) — 런타임 ffmpeg를 Debian 패키지로 제공(GitHub 정적 바이너리 다운로드 회피 → 신뢰성).
ARG NODE_VERSION=24-bookworm-slim

# ── base: corepack로 pnpm 8.15.0 고정 ──
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /repo

# ── build: 의존 설치(캐시) → shared·media-worker 빌드 → 이식 트리 산출 ──
FROM base AS build
# 1) 매니페스트만 먼저 복사 → frozen-lockfile 정합(전체 워크스페이스 프로젝트 필요) + 설치 레이어 캐시
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY services/api/package.json services/api/
COPY services/media-worker/package.json services/media-worker/
COPY apps/reporter/package.json apps/reporter/
COPY apps/control-center/package.json apps/control-center/
COPY apps/subscriber/package.json apps/subscriber/
# media-worker + 그 의존(shared)만 설치. --ignore-scripts: 워크스페이스 공유 lockfile 탓에 install이
# api 테스트 전용 패키지(redis-memory-server 등)의 postinstall까지 돌려 이 이미지 빌드를 실패시키므로
# 전역 스킵 → 필요한 바이너리만 아래에서 명시 재빌드.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @gachinol/media-worker... --ignore-scripts
# 2) 소스 복사 후 빌드(shared → media-worker; tsc만 — 네이티브/바이너리 불요, turbo 불요)
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY services/media-worker/ services/media-worker/
RUN pnpm --filter @gachinol/shared build \
 && pnpm --filter @gachinol/media-worker build
# 3) 프로덕션 이식 트리(shared 실복사) → /app/out. --ignore-scripts: deploy가 정적 바이너리를
#    재다운로드(GitHub 릴리스 간헐 504)하지 않도록. 실제 ffmpeg/ffprobe는 런너에서 시스템 패키지로 제공.
#    (bullmq의 msgpackr-extract는 선택적 네이티브 → 미빌드여도 JS 폴백)
RUN pnpm --filter @gachinol/media-worker deploy --prod --ignore-scripts /app/out

# ── runner: 시스템 ffmpeg(신뢰성) + 정적 패키지 경로를 그것으로 심링크 ──
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
# ffmpeg/ffprobe = Debian 패키지. 코드가 ffmpeg-static/ffprobe-static 경로를 setFfmpegPath로 하드 주입하므로
# (services/media-worker/src/ffmpeg.ts), 그 경로들을 시스템 바이너리로 심링크해 채운다.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/out ./
# ffprobe-static는 전 플랫폼 바이너리(수백 MB)를 번들 → 시스템 ffprobe로 대체하므로 bin/을 통째 제거 후 심링크만 남긴다.
RUN set -eux; \
    FFMPEG_TS="$(node -e 'process.stdout.write(require("ffmpeg-static")||"")')"; \
    FFPROBE_TS="$(node -e 'process.stdout.write(require("ffprobe-static").path||"")')"; \
    rm -rf "$(dirname "$(dirname "$(dirname "$FFPROBE_TS")")")"; \
    mkdir -p "$(dirname "$FFMPEG_TS")" "$(dirname "$FFPROBE_TS")"; \
    ln -sf "$(command -v ffmpeg)" "$FFMPEG_TS"; \
    ln -sf "$(command -v ffprobe)" "$FFPROBE_TS"; \
    "$FFMPEG_TS" -version | head -1; "$FFPROBE_TS" -version | head -1
RUN useradd -m -u 10001 appuser && chown -R appuser:appuser /app
USER appuser
# 큐 소비 워커 — 리스닝 포트 없음. graceful shutdown(SIGTERM) 지원(src/index.ts).
CMD ["node", "dist/index.js"]
