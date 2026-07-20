# infra — 인프라 / 로컬 개발환경

## 구성

- `docker-compose.yml`: 로컬 원클릭 기동 — **PostgreSQL 16 · Redis 7 · MinIO** (+ `gachinol-media` 버킷 자동 생성)
  - redis·minio는 phase-1 api가 아직 쓰지 않는다 — BullMQ(로드맵 3~)·업로드 단계 대비 선행 기동.
  - 기본 자격증명(`gachinol`/`gachinol`, `minioadmin`)은 **로컬 전용**. 프로덕션 재사용 금지.
- (예정) 배포 스크립트 / IaC · 라이브 인프라(RTMP/HLS — 자체 vs 매니지드 결정 후)

## 사용법

```bash
# 1) 인프라 기동 (리포 루트에서)
pnpm infra:up          # = docker compose -f infra/docker-compose.yml up -d

# 2) 환경변수 준비
cp .env.example .env   # JWT_ACCESS_SECRET/JWT_REFRESH_SECRET(각 32자+, 서로 다르게),
                       # SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD 채우기

# 3) 마이그레이션 + 시드
pnpm --filter @gachinol/api prisma:migrate
pnpm --filter @gachinol/api prisma:seed

# 4) API 기동
pnpm --filter @gachinol/api dev

# 종료
pnpm infra:down
```

## 상태

docker-compose 완료(로드맵 항목 4 선행 착수). 배포/IaC·라이브 인프라는 미착수.
