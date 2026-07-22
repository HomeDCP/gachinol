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
  })
  .refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET, {
    message: 'access/refresh 시크릿은 서로 달라야 한다',
  });

export type Env = z.infer<typeof envSchema>;
