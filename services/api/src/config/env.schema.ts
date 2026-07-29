import { z } from 'zod';

/** 환경변수 스키마 — 부팅 시 zod 파싱 실패 즉사(fail-fast, 누락 키 이름 나열). 시크릿 값 로그 노출 금지 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().default(4000),
    DATABASE_URL: z
      .string()
      .refine((v) => /^postgres(ql)?:\/\//.test(v), 'postgresql:// URL이어야 한다'),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default('900s'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('14d'),
    // 미디어 파이프라인 — 미설정 시 기능만 비활성(부팅은 성공). REDIS_URL 있으면 큐·파이프라인 활성
    REDIS_URL: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('ap-northeast-2'),
    S3_BUCKET: z.string().default('gachinol-media'),
    S3_ACCESS_KEY: z.string().optional(), // 시크릿 — .env로만. 미설정 시 S3Service 첫 사용에 도메인 예외
    S3_SECRET_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true), // MinIO
    // 실기기 presign 호스트 분리 — 미설정 시 S3_ENDPOINT 사용
    S3_PUBLIC_ENDPOINT: z.string().optional(),
    S3_PRESIGN_EXPIRES_SEC: z.coerce.number().int().default(900), // = UPLOAD_URL_TTL_SEC
    DOWNLOAD_URL_TTL_SEC: z.coerce.number().int().default(900),
    MEDIA_JOB_ATTEMPTS: z.coerce.number().int().default(3),
    MEDIA_JOB_BACKOFF_MS: z.coerce.number().int().default(5000),
    // 프리뷰/트랜스코딩 프로파일 (worker와 공유 — payload 조립값)
    MEDIA_RENDITION_HEIGHT: z.coerce.number().int().default(720),
    MEDIA_PREVIEW_HEIGHT: z.coerce.number().int().default(360),
    MEDIA_PREVIEW_BITRATE_KBPS: z.coerce.number().int().default(600),
    // AI 분석 홉 — AI_WORKER_URL 미설정 시 분석 큐 비활성(transcode→preview_generating 직행 폴백).
    // REDIS_URL && AI_WORKER_URL 둘 다 설정돼야 analysis 큐·워커 생성(회귀0 게이트).
    // OPENAI_API_KEY 등 ai-worker 전용 env는 여기에 넣지 않는다(ai-worker 전용).
    AI_WORKER_URL: z.string().optional(),
    AI_WORKER_TIMEOUT_MS: z.coerce.number().int().default(120000), // 실 STT 여유
    AI_ANALYSIS_JOB_ATTEMPTS: z.coerce.number().int().default(3),
    AI_ANALYSIS_JOB_BACKOFF_MS: z.coerce.number().int().default(5000),
    AI_ANALYSIS_CONCURRENCY: z.coerce.number().int().default(4),
    // 다채널 송출(Distribute) — 큐 게이트는 REDIS_URL만(카카오 목이 배포 기본, 외부 URL 불요).
    // KAKAO_* 둘 다 설정 시에만 실 카카오 어댑터 주입(아니면 목). 시크릿 — 값은 .env로만.
    KAKAO_REST_API_KEY: z.string().optional(),
    KAKAO_CHANNEL_ADMIN_KEY: z.string().optional(),
    PUBLISH_JOB_ATTEMPTS: z.coerce.number().int().default(3),
    PUBLISH_JOB_BACKOFF_MS: z.coerce.number().int().default(5000),
    PUBLISH_CONCURRENCY: z.coerce.number().int().default(4),
    // 주간추천(Weekly Recommendation) — 큐 게이트는 REDIS_URL 단독(계산이 순수 로컬 DB 집계라
    // 외부 URL 불요). 미설정 시 생성 요청이 인라인 계산으로 폴백한다(generating 고착 방지). 신규 시크릿 0.
    RECOMMENDATION_TOP_N: z.coerce.number().int().min(1).default(7), // 주간뉴스 꼭지 수 가정
    RECOMMENDATION_JOB_ATTEMPTS: z.coerce.number().int().default(3),
    RECOMMENDATION_JOB_BACKOFF_MS: z.coerce.number().int().default(5000),
    RECOMMENDATION_CONCURRENCY: z.coerce.number().int().default(2),
    // 고착 복구 임계 — generating|regenerating이 이 시간(ms)보다 오래면 재요청 시 강제 실패 후 재시도.
    // week_of unique라 대체 행을 만들 수 없어, 잡 유실·프로세스 사망으로 진행 중에 남으면
    // 그 주차가 API로 영구 차단된다(복구 진입점이 여기뿐).
    RECOMMENDATION_STUCK_MS: z.coerce.number().int().min(1000).default(600000),
    // 라이브+WS — WS 게이트웨이는 상시 활성(코어). Redis는 다중 인스턴스 socket.io 어댑터만 게이트
    // (미설정=단일 인스턴스 우아한 저하). RTMP/HLS는 실 인프라 미구축 — env 플레이스홀더.
    LIVE_RTMP_INGEST_URL: z.string().optional(), // 이미 .env.example 존재 — 스키마 반영
    LIVE_HLS_PLAYBACK_URL: z.string().optional(),
    LIVE_DEV_STREAM_KEY: z.string().optional(), // dev 플레이스홀더(미설정 시 'dev-'+id 합성). 프로덕션 시크릿 아님
    LIVE_COMMENT_POLL_INTERVAL_MS: z.coerce.number().int().default(3000),
    LIVE_COMMENT_BATCH_MAX: z.coerce.number().int().default(50),
    LIVE_CHAT_MESSAGE_MAX_LEN: z.coerce.number().int().default(500),
    LIVE_CHAT_RECENT_LIMIT: z.coerce.number().int().default(50),
    LIVE_CHAT_RATE_CAPACITY: z.coerce.number().int().default(5),
    LIVE_CHAT_RATE_REFILL_MS: z.coerce.number().int().default(2000),
    // DCP 상호배제 아비터 — 제온 호스트를 DCP 파이프라인과 공유할 때만 설정한다.
    // 미설정 시 완전 비활성(미디어 큐 상시 가동) → 로컬·클라우드 배포는 무영향.
    // 값 예: http://host.docker.internal:8080 (bridge 컨테이너에서 호스트 루프백 도달용).
    // DCP 측 계약은 GET {URL}/api/arbiter/state (그쪽 DSGN-API §2.1) — 우리는 GET만 한다.
    DCP_ARBITER_URL: z.string().optional(),
    DCP_ARBITER_POLL_MS: z.coerce.number().int().min(1000).default(30000), // SSE 순단 폴백
    DCP_ARBITER_TIMEOUT_MS: z.coerce.number().int().min(500).default(5000),
    // 활성 잡이 없는데 대기 잡이 있으면(디스패처가 곧 집어감) 미리 양보할지.
    // false로 끄면 busy만 보고 판단한다(계약 변경 시 킬스위치).
    // ⚠️ z.coerce.boolean()은 "false" 문자열도 true로 만들어 킬스위치를 무력화한다 → 명시적 파싱.
    DCP_ARBITER_HOLD_ON_IMMINENT: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    // DCP api 조회 실패 시 정책 — hold(보수적·DCP 우선) | run(가용성 우선)
    DCP_ARBITER_FAIL_MODE: z.enum(['hold', 'run']).default('hold'),
    // SNS 댓글 수집 실 어댑터 게이트(신규 시크릿 0 — 기존 키 재사용). 미설정 시 목 어댑터(배포 기본).
    YOUTUBE_API_KEY: z.string().optional(),
    META_PAGE_ACCESS_TOKEN: z.string().optional(),
    X_BEARER_TOKEN: z.string().optional(),
    THREADS_ACCESS_TOKEN: z.string().optional(),
  })
  .refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET, {
    message: 'access/refresh 시크릿은 서로 달라야 한다',
  });

export type Env = z.infer<typeof envSchema>;
