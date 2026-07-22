# services/media-worker — 미디어 처리 워커

**Node + FFmpeg (BullMQ)**. `media` 큐에서 잡을 받아 영상을 처리하고, 결과를 **BullMQ 잡 리턴값**으로 돌려준다.

## 아키텍처 (승인된 결정)

- worker는 **DB·API 토큰 없이** 순수 FFmpeg 컴퓨트만 한다. **S3 자격만** 소비(`REDIS_URL` + `S3_*`).
- 처리 결과(`JobResultOf<T>`)를 `job.returnvalue`로 반환 → **api가 QueueEvents로 인프로세스 수신**해
  MediaAsset 생성 + 상태전이를 수행(**api가 유일한 DB 기록자**). worker→api HTTP 콜백 **없음**.
- 잡 계약(큐 이름·`MediaJobData`·`JobResultMap`)의 단일 원천은 `@gachinol/shared`
  (`packages/shared/src/media/media-job.ts`). 사본 금지.

```
[api] enqueue(MediaJobData) ──▶ [BullMQ 'media' 큐 (Redis)] ──▶ [media-worker]
                                                                    │ S3 get 원본
                                                                    │ FFmpeg 변환
                                                                    │ S3 put 산출물 + sha256
   [api] QueueEvents ◀── job.returnvalue = JobResultOf<T> ─────────┘
```

## 처리 잡 3종

| job.name    | 산출물 key                          | kind        | 프로파일 |
| ----------- | ----------------------------------- | ----------- | -------- |
| `transcode` | `${prefix}rendition/720p.mp4`       | `rendition` | H.264/AAC 720p VBR + faststart |
| `preview`   | `${prefix}preview.mp4`              | `preview`   | 360p·~600kbps + faststart (기자 승인 확인용) |
| `thumbnail` | `${prefix}thumbnail.jpg`            | `thumbnail` | 단일 프레임 JPEG (짧은 클립은 seek 클램프) |

`prefix = outputKeyPrefix = 'contents/{contentId}/g{n}/'`. worker는 이 하위에만 write.
모든 산출물에 `checksumSha256`(B2B 무결성)을 항상 계산. 진행률은 `job.updateProgress(0..100)`.

## 유보 (이번 슬라이스 범위 밖)

- `auto_edit`(자동편집 마스터·`edited_master`) → 도입 시 `transcode` 결과 배열에 추가.
- `analyzing`(AI 비전/STT) 홉 → ai-worker 몫. api 파이프라인이 `processing → preview_generating` 직행(map-legal).
- HLS 패키징·실시간 WS 진행률 푸시.

## 실행

```bash
# 의존: Redis + S3(MinIO). 로컬은 pnpm infra:up (postgres/redis/minio)
pnpm --filter @gachinol/media-worker dev        # tsx watch (인프로세스 부팅)
pnpm --filter @gachinol/media-worker build      # tsc → dist (shared dist 선행: turbo ^build)
pnpm --filter @gachinol/media-worker start      # node dist/index.js
pnpm --filter @gachinol/media-worker test       # 단위 테스트(프로파일 + 실 FFmpeg 프로세서)
```

FFmpeg/ffprobe는 `ffmpeg-static`/`ffprobe-static` 번들 바이너리 사용 — **시스템 설치 불요**, CI 재현.

## 환경변수 (`.env` — 값은 커밋 금지, 이름만 `.env.example`)

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `REDIS_URL` | (필수) | BullMQ 커넥션 (api와 공유) |
| `S3_ENDPOINT` `S3_REGION` `S3_ACCESS_KEY` `S3_SECRET_KEY` `S3_FORCE_PATH_STYLE` | (필수/기본) | S3 자격 (MinIO는 path-style) |
| `MEDIA_WORKER_CONCURRENCY` | 2 | 동시 처리 잡 수 |
| `MEDIA_FFMPEG_TIMEOUT_MS` | 1800000 | FFmpeg 무진행 워치독(ms). 진행 신호 없이 초과 시 SIGKILL→잡 실패(hang이 슬롯을 영구 점유하는 것 방지) |
| `MEDIA_RENDITION_HEIGHT` / `MEDIA_RENDITION_VBR_KBPS` | 720 / 2500 | 렌디션 프로파일 |
| `MEDIA_PREVIEW_HEIGHT` / `MEDIA_PREVIEW_BITRATE_KBPS` | 360 / 600 | 프리뷰 프로파일(payload 우선) |
| `MEDIA_THUMBNAIL_WIDTH` / `MEDIA_THUMBNAIL_AT_SEC` | 640 / 1 | 썸네일 프로파일 |

부팅 시 `REDIS_URL`·`S3_*` 누락이면 **즉사(fail-fast)**, 누락 키를 나열한다.
`DATABASE_URL`·`JWT_*`는 **참조 금지**(worker는 DB·api 무접근).

## 재시도·멱등

- `attempts`/`backoff`는 **producer(api)** 가 결정. worker는 throw만 → BullMQ가 재시도.
- 소진 시 BullMQ `failed` 종결 → api가 `attemptsMade`로 판정해 `*_failed` 전이.
- 결정적 jobId(`${type}:${contentId}:g${gen}`) + `(bucket, storageKey)` unique로 재수신 멱등.
