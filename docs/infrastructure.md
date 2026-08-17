# 배포 인프라 설계 (Infrastructure)

> 조사·산정 기준일 2026-07-24. 환율 1 USD ≈ 1,470원. 코드 실측값 + 시장 조사 종합.
> CLAUDE.md의 "미정" 2건(서버 사양·라이브 인프라)에 대한 결정안. **가격은 조사 시점 기준이며 계약 전 재확인 필요.**

## 0. 요약 (Executive Summary)

- **최대 비용 변수는 컴퓨트가 아니라 egress(전송)와 스토리지다.** 영상 서비스이기 때문. 트랜스코딩 CPU는 병목이 아니다.
- **핵심 결정: 오브젝트 스토리지=Cloudflare R2 + 배포=Cloudflare CDN.** R2는 egress $0(공식) → 시청자·지사가 늘어도 전송비가 0에 수렴. AWS S3/CloudFront 서울($0.12~0.13/GB)에 영상을 태우면 12지사·20TB/월 기준 월 ~$2,400 vs R2+CF ~$0. **이 한 가지가 프로젝트 재무를 좌우한다.**
- **라이브=Cloudflare Stream.** 인코딩·다채널 동시송출(최대 50 목적지) 무료, 한국 리전 가격 페널티 없음. (AWS IVS 한국은 조사 대상 중 최고가라 배제.)
- **AI 워커는 GPU 불필요.** 한국어 STT는 리턴제로(RTZR) API(월 $5~15), 비전은 프레임 샘플링(로컬 CPU).
- **개략 월 비용: MVP(2지사) ≈ $20~40 + 라이브 방송분. 확장(12지사) ≈ $150~350 + 라이브·AI.**
- ⚠️ **제품 정의를 바꾸는 두 발견**: (1) 카카오톡 채널 자동 발행 API 부재, (2) 5채널 동시 라이브 불가(실현 가능=YouTube+Facebook). §5 참조.

---

## 1. 배포 대상 · 자원 프로파일 (코드 실측)

| 컴포넌트 | 런타임 | 성격 | 확장 특성 |
|---|---|---|---|
| `api` | Node 24 / NestJS | REST + WebSocket(socket.io) + 인프로세스 워커 3종(분석 동시성4·송출4·추천2). 상시 | socket.io Redis 어댑터·QueueEvents CAS 멱등 → **수평확장 가능** |
| `media-worker` | Node + FFmpeg | 트랜스코딩(720p@2500k·360p 프리뷰·썸네일). 동시성 2. CPU 집약·배치 | 워커 수 = 큐 처리량. 지연 무관 |
| `ai-worker` | Python / FastAPI | STT·비전. 배치. 현재 스텁 | 외부 API 위임 시 상시 자원 거의 0 |
| PostgreSQL 16 | — | 메타데이터만, 수 GB(작음) | MVP 셀프호스트로 충분 |
| Redis | — | BullMQ 큐 + socket.io pub/sub + 캐시 | 셀프호스트 or Upstash |
| 오브젝트 스토리지 | S3 호환 | 영상 원본+산출물, **누적 증가** | 최대 비용 축 |

**스토리지 증가량** (인코딩 기본값 기준, 콘텐츠 1분 ≈ 113MB = 원본~90 + 720p~19 + 프리뷰~4.5):

| 단계 | 업로드량 | 월 누적 증가 |
|---|---|---|
| MVP (2지사) | 하루 2~4건 × ~10분 | **70~135 GB/월** |
| 12지사 확장 | 하루 12~36건 × ~10분 | **0.4~1.2 TB/월** |

**트랜스코딩 CPU는 병목 아님**: 12지사 풀가동(하루 ~360분)도 동시성 2로 수 시간 내 처리. 4 vCPU 1대가 MVP 전체(api+워커) 수용.

---

## 2. 권장 아키텍처

```
                         ┌─────────────── Cloudflare ───────────────┐
[기자앱/구독자앱/관제앱]   │  R2(스토리지, egress $0) · CDN · Stream(라이브)│
   │  REST/WS              └───────────────▲──────────────────────────┘
   ▼                                       │ 서명 URL·HLS
[api (VM, 서울/싱가포르 리전)] ── S3 API ───┘
   ├ REST + socket.io(실시간 채팅·프롬프터)   ← 지연 민감 → 저지연 리전
   ├ BullMQ(Redis) → media-worker(FFmpeg 트랜스코딩)  ← 지연 무관 → 저가 VM 가능
   ├ analysis 홉 → ai-worker(HTTP) → RTZR STT API
   └ distribution 홉 → 카카오 알림톡(딜러사) / YouTube·FB 송출
[PostgreSQL16 + Redis]  ← MVP: api VM에 셀프호스트
```

**리전 분리 원칙**: 실시간(socket.io) API는 저지연 리전(Contabo 싱가포르 ~90ms / AWS Lightsail 서울 / NCP)에, **배치 트랜스코딩은 지연 무관하니 최저가 VM**에 둘 수 있다. 영상 전송은 Cloudflare 서울 PoP가 흡수하므로 origin 위치가 시청 품질을 좌우하지 않는다.

---

## 3. 단계별 구성 · 월 비용

### MVP (애월·제주시 2지사)

| 컴포넌트 | 솔루션 | 사양 | 월 비용 |
|---|---|---|---|
| api + 워커 3종 + ai-worker(CPU) | Contabo 싱가포르 VPS (또는 Lightsail 서울) | 4 vCPU / 8GB | ~$7 |
| PostgreSQL 16 + Redis | 위 VM 셀프호스트 | — | $0 |
| 미디어 트랜스코딩 | 위 VM(동시성 2) | — | $0 |
| 오브젝트 스토리지 | **Cloudflare R2** | 70~135 GB↑ | $3~6 (egress $0) |
| CDN | **Cloudflare** (Free 또는 Pro $20) | HLS/mp4 | $0~20 |
| STT | **RTZR API** (10h 무료 + ₩1,000/h) | ~18h/월 | ~$5 |
| 요약·태깅 | LLM API | | $2~5 |
| **소계 (라이브 제외)** | | | **≈ $20~45/월** |
| 라이브 (방송 시작 시) | Cloudflare Stream | 주 2회×2h, 200명 | +$208 |

### 확장 (12지사, 시청자 수천)

| 컴포넌트 | 솔루션 | 월 비용 |
|---|---|---|
| api (수평확장 1~2대, socket.io Redis 어댑터) | Contabo/Lightsail | $15~40 |
| media-worker (전용 VM, 동시성 4~6) | 8 vCPU | $12~20 |
| PostgreSQL (HA) | Neon 관리형 또는 셀프호스트 HA | $15~40 |
| Redis | 셀프호스트 또는 Upstash | $10~20 |
| 오브젝트 스토리지 | **R2** (누적 5~15TB) | $75~225 (egress $0) |
| CDN | **Cloudflare** | $0~20 |
| STT | RTZR (~132h) | ~$83 |
| 비전 | Gemini Flash-Lite 키프레임 | $5~10 |
| 제주 릴레이(선택) | 소형 온프레미스 1대 | 1회성 HW |
| **소계 (라이브 제외)** | | **≈ $215~460/월** |
| 라이브 | Cloudflare Stream (2000명 시) | +$2,076 |

> egress를 AWS 서울에 태울 경우 확장 스토리지/전송만으로 **월 $2,000+** 추가 → **R2+Cloudflare가 유일하게 지속 가능한 구조.**

---

## 4. "미정" 결정안 (CLAUDE.md §12)

### 결정 A — 서버 사양

#### A-0. 제온 단독 사용 전환 (2026-08-17, [A-1]·[A-2] 완료)

**제온(192.168.0.101)을 공유하던 DCP 파이프라인이 영구 철수해 이제 gachinol 단독 사용이다.**
회수 자원과 재배분 결과 — **모든 값은 제온 실측 근거**다(추정 없음).

**회수**: CPU 32C/64T 전부 · dcpx cgroup 상한 29.25GiB 해제 · **2TB 전용 NVMe**(`/srv/dcpwork`) ·
포트 `:443`·`:8080`. ※ 실 RSS 회수는 0.2GiB뿐이다(dcpx가 idle이었다) — **실질 이득은 "상한 해제"**다.

**① 상호배제 해제**([A-1]): `docker-compose.xeon.yml`에서 `DCP_ARBITER_URL` 제거 →
`DcpArbiterService`가 `enabled=false`로 부팅. **DCP api가 사라지기 전에 이 해제를 먼저 해야 했다** —
fail-mode 기본값이 `hold`라 조회 실패 시 미디어 큐가 영구 정지한다(대장 #90이 밟은 경로).
코드(`services/api/src/arbiter/` 8파일)는 제온 외 환경 대비로 **보존**한다.

**② CPU·동시성**([A-2]): `cpus: 8 → 32`, `MEDIA_WORKER_CONCURRENCY: 1 → 2`.

| cpus | 소요 | speed | | 동시 구성 | 처리량 |
|---|---|---|---|---|---|
| 4 | 130.7s | 0.90x | | 2 × 16 | 3.00건/분 |
| 8(종전) | 65.2s | 1.81x | | 4 × 8 | 2.40건/분 |
| 16 | 32.2s | 3.68x | | 8 × 4 | 2.40건/분 |
| **32** | **18.2s** | **6.55x** | | 4 × 16 | 3.60건/분(전 코어) |
| 64 | 18.0s | 6.59x | | | |

*(실기 촬영본 1080p HEVC 10bit 117.9초 → 720p, 프로파일은 `ffmpeg.ts transcode()`와 동일)*

**x264 `veryfast`는 물리 코어 32에서 포화한다** — HT 32스레드를 더 줘도 0.2초 차이(이득 0.6%).
처리량 최대는 4×16이지만 **실 워크로드가 하루 1~9건**이라(01 §C-5: MVP 주 5건, 12지사 주 60건)
병목은 처리량이 아니라 **지연**이다 — 기자가 업로드 후 프리뷰를 기다린다.
⇒ 물리 코어만 쓰는 32를 택했다. **실 컨테이너 검증: 18.0s / speed 6.61x(종전 65.2s 대비 3.6배).**

**③ 메모리**: 합계 6.75 → **14.25GiB**(api 2 · media-worker 3 · postgres 4 · minio 2 · ai-worker 2 ·
redis 1 · web 0.25). 인코딩 실측 **392MiB/건**(동시 2건에서 394로 선형).
나머지 **~16.75GiB는 페이지캐시·OS 여유로 의도적으로 남긴다** — 미디어 IO가 캐시 의존적이고,
리밋을 꽉 채우면 OOM 시 컨테이너가 먼저 죽는다. cgroup limit은 **상한이지 예약이 아니라** 미사용분을 잡지 않는다.

**④ 디스크**: MinIO 데이터를 **`/srv/dcpwork/minio`(2TB NVMe)** 로 이전. `pgdata`는 루트 유지
(작고, 별도 NVMe 분리가 인코딩 중 IO 격리에 유리).

| 시나리오 | 월 증가 | 루트 여유 365GB로 |
|---|---|---|
| MVP(주 5건) | 3.3GB | 8년+ |
| 12지사(주 60건) | **39GB** | **9개월** |

콘텐츠 1건 ≈ **180MB**(2분물: 원본+렌디션+프리뷰+썸네일) 실측. **이전 시점은 지금이 최적이었다** —
567MB라 1.6초에 끝났고, 수백 GB로 커진 뒤엔 몇 시간 다운타임이다.
소유권 **`root:root 0700`** (minio 공식 이미지가 컨테이너 내부에서 uid 0으로 동작 — 실측).
DCP 잔재인 setgid `dcpauto` 규약은 승계하지 않는다. 미디어에 주민 제보 등 비공개 콘텐츠가 들어가므로 최소 권한.
⚠️ `df`가 `/srv/dcpwork`를 36G 사용으로 표시하는 것은 **누수가 아니라** XFS(`rmapbt=1 reflink=1`)의
per-AG 메타데이터 예약이다(AG 64 × 571MiB). **실가용 1.8TB.**

**⑤ 노출**: MinIO 콘솔(9001)을 **루프백 전용**으로 축소(앱은 콘솔을 쓰지 않는다. 접근은 SSH 터널).
9000은 앱이 서명 URL로 직접 쓰므로 LAN 유지. **`:443` 전환은 도메인 확정이 선행**이다 —
named tunnel도 Let's Encrypt TLS도 도메인을 요구한다. 그때까지 `gachinol-quick-tunnel.service` 유지
(⚠️ URL이 재기동마다 바뀐다 — 실제 2회 변경).

**부팅 자동복구**(정적 검증 5항 통과): fstab UUID 등재 · `srv-dcpwork.mount` active ·
docker.service enabled · docker가 `local-fs.target` 이후 시작 · 7서비스 `restart: unless-stopped`.

**손대지 않은 것**: DCP 보존 자산 전부(이미지·볼륨·레포·`/var/lib/dcpauto`·릴레이 유닛·NAS 마운트) ·
`dcpx-fan-control`/`dcpx-nas-mounts`(이름만 dcpx인 호스트 인프라) · `prune` 계열 미실행
(**build cache 22.49GB / 회수 가능 6.79GB는 보고만** — 실행은 운영자 승인 사항) · `/etc/nftables.conf` 무변경.

#### A-1. 클라우드 이관 시 사양(원안 유지)

- **MVP**: 4 vCPU / 8GB VM **단일 노드**(Contabo 싱가포르 or Lightsail 서울)에 api+워커+DB 전부. 관리형 DB 불필요.
- **확장 트리거**: (1) media-worker CPU가 큐 지연 유발 → 워커 VM 분리(8 vCPU), (2) WS 동시연결·요청이 단일 api 포화 → api 2대+로드밸런서(이미 socket.io Redis 어댑터로 대응 설계됨), (3) DB HA 필요 → Postgres만 Neon/RDS 이관.
- **판단 근거**: 트랜스코딩 CPU가 병목이 아니고, 부하 대부분이 스토리지·전송이라 컴퓨트는 소형으로 시작해 필요 시 수직→수평 확장.

### 결정 B — 라이브 인프라 (자체 RTMP/HLS vs 관리형)
- **관리형 = Cloudflare Stream 채택.** 근거: 인코딩·simulcast 무료, 한국 리전 페널티 없음, 전담 인력 불필요, api가 이미 S3/BullMQ 기반이라 API 연동만 추가.
- **자체 구축(OvenMediaEngine 등)은 유예**: 월 라이브 전송비가 $2,000을 넘고 국내 CDN 계약이 준비된 시점에 재검토. 그 전엔 관리형이 총소유비용 우위. (자체 구축 시 46.7TB/월·피크 6Gbps 감당할 CDN이 전제.)
- **제주 현지**: 전면 온프레미스는 비권장(운영 부담). **재난 라이브 회복력 목적의 소형 RTMP 릴레이 1대**만 하이브리드로 검토.

### 결정 C — 스토리지·CDN
- **Cloudflare R2 + Cloudflare CDN** 확정. egress $0가 이 프로젝트의 최대 레버리지.
- 대안(비용 유사): Backblaze B2 + Bunny CDN.
- **회피**: AWS S3/CloudFront 서울에 영상 egress를 태우는 구조.

#### C-1. 공개 렌디션 서빙 — 버킷 공개 설정 전제 · 캐시 TTL 정책 (D-T8 / T-W2-33)

`published` 콘텐츠의 720p 렌디션·썸네일은 공개 버킷/프리픽스로 **복사**되어 CDN이 서빙한다
(원본 버킷은 계속 비공개, 서명 URL 전용). 이 절이 그 운영 전제의 원천이다.

**① 버킷 공개 설정은 코드가 하지 않는다 — 사람이 먼저 해둬야 한다 (필수 선행)**

- **R2에는 오브젝트 ACL이 없다.** 그래서 `S3Service.copyObject`는 `ACL: public-read` 같은 것을
  붙이지 않으며, 붙일 수도 없다. 공개 여부는 **버킷 단위 설정**으로만 정해진다.
- 따라서 아래가 **배포 전에 수동으로** 준비돼 있어야 하고, 안 돼 있으면 복사는 성공하는데 CDN에서
  403이 난다(코드는 이 상태를 감지하지 못한다 — 오브젝트는 실제로 존재하기 때문이다):
  1. **공개 전용 버킷을 따로 판다**(`MEDIA_PUBLIC_BUCKET`). 원본 버킷을 공개로 돌리는 건 금지 —
     원본·중간 산출물·주민 업로드가 통째로 공개된다. 버킷을 나눌 수 없으면 최소한 프리픽스
     (`MEDIA_PUBLIC_PREFIX`, 기본 `public`)만 공개하는 규칙이 CDN 쪽에 서 있어야 한다.
  2. 그 버킷에 **커스텀 도메인을 바인딩**한다(Cloudflare 대시보드 → R2 → Settings → Custom Domains).
     `MEDIA_PUBLIC_BASE_URL`이 이 도메인이다. `r2.dev` 공개 URL은 레이트리밋이 있어 운영용이 아니다.
  3. 커스텀 도메인은 **자동으로 Cloudflare CDN을 탄다** — 여기서 egress $0가 발생한다.
- **로컬/MinIO**: 버킷 익명 read 정책(`mc anonymous set download`)으로 같은 모양을 만든다.

**② `MEDIA_PUBLIC_BASE_URL`이 공개 서빙 전체의 마스터 스위치다**

- **미설정(현행 기본값·제온 운영 상태)**: 복사도 하지 않고 공개 URL도 발급하지 않는다. 피드·재생은
  전부 **서명 URL(`presignGet`) 폴백**으로 동작한다 — 즉 이 문서의 나머지가 전부 꺼져 있어도 서비스는
  정상이다. (복사만 켜고 서빙을 끄면 아무도 안 읽는 사본이 매 발행마다 쌓이므로 한 스위치로 묶었다.)
- **설정**: 복사가 돌고, 복사에 성공한 위치가 `media_assets.public_bucket`/`public_key`/`public_copied_at`에
  기록된다. 피드는 **그 기록만 보고** 공개 URL을 판정한다 — 항목마다 S3 HEAD를 치지 않는다
  (T-W2-33 / 대장 #129 ⓐ. 예전엔 1페이지 20건 = 오리진 왕복 20회로, CDN을 쓰는 목적과 정면 충돌했다).
- 기록이 없으면(미복사·복사 실패·기록 도입 이전 사본) **조용히 서명 URL로 폴백**한다. 공개 URL은
  최적화지 필수 경로가 아니다.
- **켠 직후의 과도기**: 이미 발행된 과거 콘텐츠는 기록이 비어 있어 계속 서명 URL로 나간다(정상).
  CDN으로 올리려면 해당 콘텐츠를 다시 발행해 복사 훅(멱등)을 태우면 된다.

**③ 캐시 TTL 정책 — `public, max-age=3600, s-maxage=31536000`**

값의 단일 원천은 `services/api/src/media/public-media.service.ts`의 `PUBLIC_MEDIA_CACHE_CONTROL`
**상수**다(env 아님 — 값 자체가 삭제 SLA와 엮인 정책이라 배포별로 흔들리면 안 된다).

| 층 | TTL | 근거 |
| --- | --- | --- |
| 엣지(Cloudflare) `s-maxage` | 1년 | 공개 키에 세대가 박혀 있고(`contents/{id}/g{n}/…`) `published`의 유일한 출구가 종결 상태 `archived`라 **같은 URL의 바이트가 바뀌는 경로가 없다**(URL이 곧 버전). 게다가 엣지는 CF Purge API로 **강제 무효화가 된다**. |
| 브라우저 `max-age` | 1시간 | 브라우저 캐시는 purge가 닿지 않는 **유일한 층**이다. 보관·비공개 전환의 실효 기한이 24시간(02 §D-T8 필수 대칭)이라 브라우저 TTL을 그 안쪽에 둬야 "지웠는데 계속 재생된다"가 구조적으로 막힌다. 재요청은 엣지가 받고 egress는 $0라 비용 부담이 없다. |
| `immutable` | **안 붙인다** | 붙이면 브라우저가 만료 전 재검증을 아예 생략해 위 24시간 SLA와 충돌한다. 불변성 이득은 엣지 TTL로 이미 취했다. |

- 구현 주의: S3/R2의 `CopyObject`는 기본(`MetadataDirective: COPY`)에서 요청의 `Cache-Control`을
  **무시**한다 → `REPLACE`로 보내야 반영된다. 그런데 `REPLACE`는 원본 메타데이터를 전부 버리므로
  **`ContentType`을 함께 넘기지 않으면 `binary/octet-stream`이 되어 브라우저 재생이 깨진다.**
  두 값은 항상 짝으로 넘긴다(`S3Service.copyObject`).
- **보관(archived) 시**: 기록을 먼저 비우고 → 공개 객체를 지우고 → CF 퍼지를 호출한다(순서 분리 금지).
  퍼지는 `CF_ZONE_ID`·`CF_API_TOKEN`이 둘 다 있을 때만 실행되며, 없으면 `attempted:false`를 로그로
  남긴다 — **공개 서빙을 켰다면 이 두 키도 같이 켜야 24시간 SLA가 실효한다.**

### 4-C-2. 스토리지 CORS — **웹 업로드의 선결 조건** (대장 #148, 2026-08-17 신설)

**웹앱에서 영상을 올리려면 스토리지 버킷에 CORS 정책이 있어야 한다. 없으면 업로드가 시작조차 못 한다.**

- **왜 필요한가**: 영상은 api를 거치지 않고 앱 → 스토리지로 **직접**(presigned PUT) 올라간다. 그래서
  웹앱 오리진(`https://watch.<도메인>`)과 스토리지 오리진이 **다르다**. 브라우저는 이런 교차 오리진
  요청 중 "단순하지 않은 것"(`PUT` + `Content-Type` 지정)을 보내기 전에 **프리플라이트(OPTIONS)**로
  허용 여부를 먼저 묻고, 허용 응답이 없으면 **본 요청을 아예 보내지 않는다**.
- **왜 지금까지 없었나**: 기존 기자 앱은 **네이티브**였다(`expo-file-system` → OS 네트워크 스택).
  네이티브에는 CORS 개념이 없어 프리플라이트 자체가 없었다. **웹 피벗이 만든 신규 요구사항**이며,
  02 §D-T4가 "R2·MinIO CORS 설정도 별도 필요"라 적어 두었으나 **그것을 수행하는 태스크가 계획에 없다.**
- **왜 개발 중에는 안 보이나**: 로컬 MinIO는 기본값이 관대해 **어떤 오리진이든 허용**한다
  (조율자 실측 2026-08-17: `OPTIONS`에 `Access-Control-Allow-Origin`이 요청 오리진 그대로 반사됨).
  **R2는 기본이 거부**다 → 개발·테스트는 전부 통과하고 **R2로 옮기는 순간 터진다**(#129와 같은 유형).
- **증상이 고약하다**: 업로드 버튼을 눌러도 아무 일이 없고 **서버 로그에 흔적이 0**이다 — 요청이
  서버에 도달하기 전에 브라우저 안에서 차단되기 때문이다. 브라우저 devtools 없이는 진단이 사실상 불가능하다.

**R2 전환 시 체크리스트**(코드가 아니라 Cloudflare 대시보드/API 설정):

| 항목 | 값 | 비고 |
|---|---|---|
| `AllowedOrigins` | `https://watch.<도메인>` (+ 기자·관제 웹을 열면 그 오리진도) | **도메인 확정(G9 ①) 후 확정**. 와일드카드 금지 |
| `AllowedMethods` | `PUT`(업로드) · `GET`·`HEAD`(조회) | |
| `AllowedHeaders` | `Content-Type`(+ 쓰는 커스텀 헤더가 있으면 그것도) | presigned URL은 서명이 쿼리에 있어 `Authorization` 불요 |
| `ExposeHeaders` | `ETag` | 멀티파트(D-T4) 승격 시 클라가 파트 ETag를 읽어야 한다 |
| `MaxAgeSeconds` | 3600 | 프리플라이트 캐시 — 업로드마다 왕복하지 않게 |

**검증 방법**(설정 후 반드시 실행 — 실패하면 브라우저가 조용히 막는다):
```bash
curl -i -X OPTIONS "https://<스토리지 오리진>/<버킷>/probe.mp4" \
  -H "Origin: https://watch.<도메인>" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type"
# 기대: 2xx + Access-Control-Allow-Origin 이 그 오리진과 일치 + Allow-Methods 에 PUT
```

**영향 범위**: T-W2-09(주민 업로드, 완료) · T-W2-02(기자 웹 업로더, 미착수) — **웹에서 파일을 올리는
모든 경로**. 재생(GET)은 현재 서명 URL이라 같은 정책의 `GET`이 필요하고, 공개 서빙(#129)으로 전환하면
CDN이 앞에 서므로 그때는 CDN 쪽 헤더 정책과 함께 본다.

---

## 5. ⚠️ 제품 정의를 바꾸는 발견 (구현 전 결정 필요)

### 5-1. 카카오톡 채널 자동 발행 API 부재 — **최상위 기술 리스크 (재검증 확정)**

**결론: 백엔드가 카카오톡 채널에 영상을 프로그램으로 게시하는 것은 불가능하다 (2026 재검증, 이중 확인).**
- 카카오톡 채널 공개 API는 엔드포인트 6종이 전부 **고객관리용**(관계확인·고객파일). **소식(포스트)·영상 게시 엔드포인트 없음.** (developers.kakao.com 카카오톡 채널 API)
- 카카오 공식 데브톡: "채널 포스트 생성/조회 기능은 디벨로퍼스에서 제공하지 않음."
- 딜러사(공식 대행사) 경유로도 채널 소식 발행 자동화 **불가** — 대행사는 알림톡/친구톡 **발송**만 대행.
- 알림톡/친구톡으로 **영상 직접 첨부 불가** — 친구톡 프리미엄 동영상형은 **카카오TV 선업로드** 영상만 지정 가능. 실무 최선은 "썸네일 이미지 + 링크 버튼". 친구톡 발송 자체가 공식 대행사 계약 필수·건당 과금.

**게시 자동화 정도별 선택지:**

| 단계 | 방식 | 실현성 | 필요 조건 |
|---|---|---|---|
| 완전자동 | 백엔드→채널 소식 직접 발행 | ❌ 불가 | 공개 API 없음 |
| **반자동 (채택)** | 백엔드가 게시자산 준비 → 담당자가 채널 관리자 앱/웹으로 게시 | ✅ 높음 | 채널 관리자 권한, 최종본 전달 경로 |
| 메시지 자동 | 친구톡 대행사 API로 썸네일+링크 푸시 | ⚠️ 부분 | 대행사 계약, 영상은 카카오TV 선업로드 |

**채택 모델 — 반자동 (기존 코드에 어댑터 교체만):**
- **1차 배포(완전자동)**: 자체 구독자 앱(완성) + YouTube(Data API 자동 업로드)
- **카카오 채널(반자동)**: 백엔드가 **① 카카오 최적 렌디션 ② 자동 생성 캡션 ③ 썸네일 ④ 딥링크**(`pf.kakao.com/_ID`)를 만들어 → 앱 내 다운로드 링크(R2 서명 URL)로 담당자에 전달 + 통지 → 담당자가 **채널 관리자 앱**(iOS/Android, 동영상 소식 업로드 지원)으로 게시 → 게시 완료 확인 시 Publication `published`. 우리 `Publication` 상태머신·센터 엔드포인트·UI 재사용.
- **코드 변화 = 재작업 아님, 어댑터 교체**: `KakaoMockAdapter` → `KakaoManualPublishAdapter`(게시자산 생성+통지, `published`는 담당자 확인). media-worker에 **카카오용 렌디션 프로파일** 추가. `YouTubeAdapter`(Data API) 신설.
- ⚠️ **카카오 채널 영상 최대 해상도·용량·길이는 공식 미공개**(비율 2:1~9:16만 확정) → 관리자센터 **시험 업로드로 실측** 후 프로파일 프리셋 고정.
- 12채널 = 12회 수작업 → 백엔드가 채널별 캡션·썸네일·딥링크 자동 생성으로 담당자 부담 최소화.

> 이 모델은 API 의존·대행사 계약·법적 리스크를 제거한다. 카카오는 "유입 채널"이고 실제 재생은 자체 앱/YouTube.

### 5-2. 5채널 동시 라이브 불가
| 플랫폼 | 송출 | 댓글 API | 판정 |
|---|---|---|---|
| YouTube | ✅ | ✅ `liveChatMessages.streamList` | **1순위 구현** |
| Facebook | ✅ RTMPS | △ App Review 필수(팔로워 100↑·60일↑) | 앱리뷰 후 |
| Instagram | 서드파티 송출 비공식 | ❌ | 유예/링크 홍보 |
| X | 송출 O | ❌ 읽기 종량제 $0.005/건 | 유예 |
| **Threads** | ❌ 라이브 기능 없음 | N/A | **요구사항 삭제** |
- **대응**: CLAUDE.md의 "YouTube·FB·IG·X·Threads 동시 라이브"를 **"YouTube + Facebook 동시 + 나머지 링크 홍보"**로 하향. 프롬프터도 YouTube+FB 중심. **Meta App Review는 리드타임 2~4주 → 지금 착수(크리티컬 패스).**

---

## 6. 서비스 개시 전 규제 체크리스트 (우선순위)

> 법률 자문 아님. 확정 판단 필요 항목은 전문가 확인.

1. **운영 주체 확정**(법인/비영리) + 사업자등록 — 모든 신고의 전제
2. **촬영 동의서 체계**(초상·음성·이용범위·B2B 재판매·아동 법정대리인) — **첫 촬영 전** 필수. 언론 예외 적용 불확실 → 동의 기반이 유일 안전책
3. **개인정보처리방침·이용약관** 공개 + 앱 내 신고/차단 기능(익명 시청·닉네임 채팅도 방침 의무)
4. **카카오 비즈니스 채널 인증 + 딜러사 계약** + §5-1 모델 재설계
5. **YouTube 쿼터 증량 심사 + Meta App Review 착수** — 리드타임 최장, 지금 시작
6. **음원 라이선스** — 로열티프리 라이브러리(Epidemic/Artlist) 단일화 권장. AI 학습에 음악 사용 시 별도 서면 허락
7. 커머스 개시 시: **통신판매업 신고 → PG 계약(정산은 PG가 판매자에 직접 지급) → 중개 고지·판매자 정보 열람 UI → 에스크로**
8. 자본금 1억 초과 시 **부가통신사업 신고**(1개월 내). 이하면 면제
9. 성장 대비 **불법촬영물 사전조치** 기능 선반영(매출 10억↑/일 10만↑ 시 발동)
10. 특산물 품목별 **식품·원산지 표시**

**최상위 리스크 3**: ① 카카오 발행 API 부재(기술) ② 초상권·개인정보(6채널 확산 후 삭제 불가) ③ 라이브커머스 금전(정산 개입 = 무등록 PG, 개인 판매자 분쟁 귀속).

---

## 7. 구현 로드맵 (다음 작업)

**진행(2026-07-25)**: api·media-worker·ai-worker **Dockerfile(멀티스테이지)** + **프로덕션 compose**(`infra/docker/docker-compose.prod.yml`) + **GitHub Actions CI/CD**(`.github/workflows/ci.yml`·`build-images.yml`) 완료. 남은 작업:

1. ~~**컨테이너화**~~ ✅ — api·media-worker Dockerfile(멀티스테이지·`pnpm deploy`·glibc bookworm), ai-worker Dockerfile 정비, 루트 `.dockerignore`. Prisma는 배포 트리에서 재생성, `prisma`를 api 런타임 의존으로 이동(엔트리포인트 `migrate deploy`).
2. ~~**프로덕션 오케스트레이션**~~ ✅ — `infra/docker/docker-compose.prod.yml`(postgres·redis·api·media-worker·ai-worker). 시크릿 env 주입(`env.prod.example`), 헬스체크·`restart: unless-stopped`. 개발용 `infra/docker-compose.yml`과 분리.
3. **환경 설정** — S3 호환 클라이언트를 R2 엔드포인트로(현 코드가 `S3_ENDPOINT`·`S3_FORCE_PATH_STYLE` 지원 → env만으로 전환 가능). Cloudflare CDN 앞단. (템플릿은 `env.prod.example`에 반영, 실 R2 계정 전환은 배포 시)
4. **CI/CD** — GitHub Actions: ~~lint·typecheck·test~~ ✅ + ~~이미지 빌드→GHCR~~ ✅ (PR=빌드검증, main=푸시). **배포(CD)**는 서버 확정 후. 마이그레이션은 api 엔트리포인트가 `prisma migrate deploy`.
5. **관측성** — 최소 로그 수집 + 헬스 엔드포인트(이미 `/health/liveness`·`/health/readiness` 있음) + 업타임 모니터.
6. **§5 대응 구현 (착수점 B — 유예)** — `KakaoMockAdapter`→`KakaoManualPublishAdapter`(게시자산+통지), YouTube 라이브·댓글 실 어댑터, IG/X/Threads 스코프 정리, Meta App Review 병행.
7. **`infra/scripts/`** — 배포·백업(R2)·마이그레이션·시드 스크립트.

**착수 순서**: ✅ 1·2·4(컨테이너화·compose·CI) 완료 → 다음: 3(R2 실전환)·배포(CD)·5(관측성) → 6(실 어댑터, 착수점 B). 인프라 골격을 먼저 세우고 실 연동은 규제·심사 리드타임과 병행.

---

## 8. 현재 상태 · 다음 결정 (세션 이어가기용)

**진행 상태**: 앱 3종 + 백엔드 6도메인(Ingest·Process·Analyze·Distribute·Live·Monetize 일부) 구현·머지 완료(PR #1~#10). **배포 산출물 착수(2026-07-25)**: 프로덕션 Dockerfile 3종·`infra/docker/` compose·GitHub Actions CI/CD 완료(§7). 남은 것: 배포(CD)·R2 실전환·실 어댑터(착수점 B).

**확정된 것** (조사 근거, §1~§5):
- 스토리지·CDN = Cloudflare R2 + Cloudflare CDN (egress $0 — 최대 레버리지)
- 라이브 = Cloudflare Stream (관리형), AI STT = 리턴제로(RTZR), GPU 불요
- 서버 = 4vCPU/8GB 단일 VM 시작 → 병목별 확장
- 카카오 채널 = **반자동 게시 모델**(백엔드 게시자산 준비 + 담당자 관리자앱 게시). 직접 발행 API 없음 확정
- 라이브 채널 = YouTube + Facebook 동시(나머지 링크 홍보), Threads 삭제

**결정 완료** (2026-07-25):
1. 반자동 카카오 + SNS 스코프 하향 → **문서(CLAUDE.md·본 문서)에 반영 완료, 코드(어댑터)는 유예**. CLAUDE.md는 결정 문서라 확정을 먼저 반영하고, 코드 catch-up은 착수점 B로 분리.
2. 착수점 = **컨테이너화+CI/CD 먼저**로 확정·완료. 어댑터 재구현(착수점 B)은 후속.

**다음 세션 착수 후보** (§7 로드맵):
- 배포(CD): VM 프로비저닝 + SSH/compose 배포 워크플로 + R2 실전환(엔드포인트·버킷) + 관측성.
- 착수점 B(실 어댑터): `KakaoManualPublishAdapter`·YouTube Data API 업로드·미디어워커 카카오 렌디션 프로파일.
- 병행 준비(리드타임 김): Meta App Review 착수, YouTube 쿼터 증량 심사, 촬영 동의서·개인정보처리방침, 카카오 채널 영상 스펙 실측.
