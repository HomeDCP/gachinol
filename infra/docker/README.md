# infra/docker — 프로덕션 컨테이너 배포

로컬 개발 스택은 `infra/docker-compose.yml`(postgres·redis·minio). **이 디렉토리는 프로덕션 배포**용이다.

## 구성

| 파일 | 역할 |
|---|---|
| `docker-compose.prod.yml` | 프로덕션 오케스트레이션 — postgres·redis·api·media-worker·ai-worker |
| `env.prod.example` | 프로덕션 env 템플릿 → `cp … .env.prod` 후 값 채움(.env.prod는 gitignore) |

이미지 정의(멀티스테이지 Dockerfile)는 각 서비스에 있다:
- `services/api/Dockerfile` — NestJS(REST+WS+인프로세스 워커). Prisma·argon2. 엔트리포인트가 부팅 전 `prisma migrate deploy`.
- `services/media-worker/Dockerfile` — BullMQ+FFmpeg(ffmpeg-static 번들, 시스템 ffmpeg 불요).
- `services/ai-worker/Dockerfile` — FastAPI 순수 컴퓨트.

> **컨텍스트 주의**: api·media-worker는 빌드 컨텍스트 = **리포 루트**(pnpm 워크스페이스 전체 필요). ai-worker만 자기 디렉토리.

## 외부(매니지드) — 컨테이너에 두지 않음

- **오브젝트 스토리지·CDN = Cloudflare R2 + Cloudflare** (프로덕션은 MinIO 아님). `S3_ENDPOINT`를 R2로 주입.
- **라이브 = Cloudflare Stream**. 근거·비용 = [docs/infrastructure.md](../../docs/infrastructure.md).

## 배포 (단일 VM)

```bash
# 리포 루트에서
cp infra/docker/env.prod.example infra/docker/.env.prod   # 값 채우기(JWT·R2·POSTGRES 비밀번호)
docker compose -f infra/docker/docker-compose.prod.yml up -d --build
```

- api 컨테이너가 기동 시 `prisma migrate deploy`로 마이그레이션 적용(`RUN_MIGRATIONS=false`로 끌 수 있음 — 다중 인스턴스는 마이그레이션을 별도 1회 잡으로 분리 권장).
- 최초 관리자 시드(1회): 시드 스크립트는 `tsx`(devDep, `--prod` 이미지에서 제외)로 실행되므로 프로덕션
  컨테이너 안에서는 돌지 않는다. **dev 체크아웃에서 프로덕션 `DATABASE_URL`을 향해** 시드하라 —
  `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`와 프로덕션 `DATABASE_URL`을 설정하고
  `pnpm --filter @gachinol/api prisma:seed`. (전용 시드 잡 배선은 후속 CD 항목)
- 상태 확인: `docker compose -f infra/docker/docker-compose.prod.yml ps` (api healthcheck = `/health/liveness`).
- 로그: `… logs -f api media-worker`.

## CI에서 빌드한 이미지로 배포 (레지스트리 경유)

`.github/workflows/build-images.yml`이 main 푸시마다 `ghcr.io/<owner>/gachinol-{api,media-worker,ai-worker}`를 푸시한다.
VM에서는 빌드 없이 당겨 올릴 수 있다:

```bash
# .env.prod 에 REGISTRY·IMAGE_TAG 설정 후
docker compose -f infra/docker/docker-compose.prod.yml pull
docker compose -f infra/docker/docker-compose.prod.yml up -d
```

## 제온(임시 백엔드) 배포 — DCP 파이프라인과 공존

제온(192.168.0.101)에는 **가동 중인 DCP 파이프라인**이 있다. `docker-compose.xeon.yml` 오버레이를
프로덕션 compose 위에 덧씌워 공존을 안전하게 만든다(단독 사용 금지).

```bash
docker compose -f infra/docker/docker-compose.prod.yml \
               -f infra/docker/docker-compose.xeon.yml up -d
```

| 공존 장치 | 내용 |
|---|---|
| **DCP 상호배제** | api의 `DcpArbiterService`가 DCP의 `GET /api/arbiter/state`를 **읽기 전용** 조회 → `busy`면 **미디어 큐 전역 정지**(진행 중 1건만 마치고 대기, 선점 없음) |
| **네트워크** | 전부 bridge. DCP api가 host net의 `127.0.0.1:8080`에만 바인드하므로 `extra_hosts: host.docker.internal:host-gateway`로 도달 |
| **포트** | 4000(api)·9000/9001(MinIO)만 사용 — dcpx-caddy(:443)·dcpx-api(:8080)와 무충돌 |
| **리소스** | 전 서비스 메모리 하드리밋, media-worker는 `cpus: 8` + **동시성 1** |
| **스토리지** | 제온엔 오브젝트 스토리지가 없어 **MinIO** 추가(프로덕션 R2의 로컬 등가물 — R2 전환 시 이 서비스만 빼고 env 교체) |

**메모리 산술**: 우리 리밋 합 ≈ 6.5GB이지만, 아비터가 **DCP 피크와 우리 피크의 중첩을 막는다** —
DCP 인코딩 중(≈21.5GB) 우리는 정지 상태(≈1.5GB)라 실사용 ≈23GB / 32GB. DCP가 유휴일 때만 우리가
피크(6.5GB)에 도달하며 그때 DCP는 ≈0.2GB다. DCP 측이 요청한 "최소 6GB 여유"가 양쪽 모두에서 유지된다.

**아비터 관련 env**(전부 `.env`): `DCP_ARBITER_URL`(미설정=비활성)·`DCP_ARBITER_POLL_MS`·
`DCP_ARBITER_HOLD_ON_IMMINENT`·`DCP_ARBITER_FAIL_MODE`. 상태 확인:

```bash
curl -s -H "Authorization: Bearer <token>" http://192.168.0.101:4000/v1/system/processing-state
```

> ⚠️ 제온은 nftables **input DROP**이다. LAN(192.168.0.0/24)에서 4000·9000 포트에 접근하려면
> 방화벽 허용이 필요한데, 이는 **DCP 박스의 네트워크 설정 변경**이므로 별도 확인 후 수행한다.

## 아직 남은 것 (CD)

VM 프로비저닝 + SSH 배포(CD) 워크플로 + R2 백업 스크립트는 서버 확정 후. [docs/infrastructure.md](../../docs/infrastructure.md) §7·§8.
