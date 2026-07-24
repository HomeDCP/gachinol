# syntax=docker/dockerfile:1.7
# api — NestJS REST + socket.io(WS) + 인프로세스 워커(분석·송출·추천). Prisma·argon2(네이티브 모듈).
# 빌드 컨텍스트 = 리포 루트 (pnpm 워크스페이스 전체 매니페스트 필요):
#   docker build -f services/api/Dockerfile -t gachinol-api .
# glibc(bookworm) — argon2 네이티브 모듈·Prisma 쿼리엔진이 musl(alpine)에서 불안정하기 때문.
ARG NODE_VERSION=24-bookworm-slim

# ── base: corepack로 pnpm 8.15.0 고정 ──
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /repo

# ── build: 의존 설치 → shared·api 빌드(prisma generate + nest build) → 이식 트리 + 클라이언트 재생성 ──
FROM base AS build
# argon2가 현재 ABI용 prebuilt를 못 받으면 소스 컴파일로 폴백 → 빌더에만 툴체인 설치(런너엔 불필요).
# openssl: Prisma가 빌더에서 libssl 버전을 탐지(미설치 시 잘못된 엔진 기본값 경고).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl \
    && rm -rf /var/lib/apt/lists/*
# 1) 매니페스트만 먼저 복사 → frozen-lockfile 정합 + 설치 레이어 캐시
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY services/api/package.json services/api/
COPY services/media-worker/package.json services/media-worker/
COPY apps/reporter/package.json apps/reporter/
COPY apps/control-center/package.json apps/control-center/
COPY apps/subscriber/package.json apps/subscriber/
# api + 그 의존(shared)만 설치. --ignore-scripts: 공유 lockfile 탓에 install이 불필요한 패키지
# (테스트 전용 redis-memory-server 등)의 postinstall까지 돌려 빌드를 깨뜨리는 것을 막는다.
# 필요한 네이티브(argon2)·Prisma 클라이언트는 배포 트리(/app/out)에서 확정 생성한다(아래 3).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @gachinol/api... --ignore-scripts
# 2) 소스 복사 후 빌드(shared → api). api build = `prisma generate && nest build`.
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY services/api/ services/api/
RUN pnpm --filter @gachinol/shared build \
 && pnpm --filter @gachinol/api build
# 3) 프로덕션 이식 트리 → /app/out. deploy는 prod 의존의 install 스크립트를 실행한다:
#    argon2는 번들 prebuilt(prebuilds/linux-*/argon2.*.node)를 node-gyp-build가 선택 → 소스 컴파일 불요.
#    (테스트 전용 redis-memory-server 등은 prod가 아니라 애초에 제외됨 → deploy엔 --ignore-scripts 불요)
#    그 뒤 배포 트리 스키마로 Prisma 클라이언트+엔진 재생성(deploy가 .prisma/client는 보존 못 함) → 런타임 정합.
RUN pnpm --filter @gachinol/api deploy --prod /app/out \
 && cd /app/out && node_modules/.bin/prisma generate

# ── runner: 최소 런타임(openssl = Prisma 쿼리엔진 의존) ──
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/out ./
COPY services/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && useradd -m -u 10001 appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 4000
# 헬스체크 = node 전역 fetch(별도 curl/wget 불요). liveness는 v1 프리픽스 제외 경로.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health/liveness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# 엔트리포인트: (기본) prisma migrate deploy → CMD 실행. 다중 인스턴스는 RUN_MIGRATIONS=false로 분리.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
