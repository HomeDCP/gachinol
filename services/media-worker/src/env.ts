import { z } from 'zod';

/**
 * 워커 전용 env — S3 자격 + Redis만. **DATABASE_URL·JWT·API 토큰 참조 금지**
 * (worker는 순수 FFmpeg 컴퓨트, DB·api 무접근). 누락 시 부팅 즉사(fail-fast, 누락 키 나열).
 */
export const workerEnvSchema = z.object({
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default('ap-northeast-2'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  MEDIA_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  // FFmpeg 워치독 — 진행(progress) 없이 이 시간(ms) 초과 시 프로세스 SIGKILL 후 실패로 전환.
  // 손상·병적 입력으로 ffmpeg가 error 없이 hang하면 잡이 완료·실패 어느 쪽도 못 되고
  // 워커 동시성 슬롯을 영구 점유하는 것을 방지(무진행 정지 감지). 기본 30분.
  MEDIA_FFMPEG_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),
  // 트랜스코딩 렌디션 (720p·2500kbps 기본)
  MEDIA_RENDITION_HEIGHT: z.coerce.number().int().positive().default(720),
  MEDIA_RENDITION_VBR_KBPS: z.coerce.number().int().positive().default(2500),
  // 프리뷰 (360p·600kbps) — payload가 우선하나 미지정 시 기본값
  MEDIA_PREVIEW_HEIGHT: z.coerce.number().int().positive().default(360),
  MEDIA_PREVIEW_BITRATE_KBPS: z.coerce.number().int().positive().default(600),
  // 썸네일
  MEDIA_THUMBNAIL_WIDTH: z.coerce.number().int().positive().default(640),
  MEDIA_THUMBNAIL_AT_SEC: z.coerce.number().nonnegative().default(1),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** process.env 파싱 — 실패 시 누락/오류 키를 나열하고 즉사 */
export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = workerEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`미디어 워커 환경변수 검증 실패:\n${issues}`);
  }
  return parsed.data;
}
