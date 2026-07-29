import { z } from 'zod';

/**
 * 환경변수 불리언.
 *
 * ⚠️ **`z.coerce.boolean()`을 쓰면 안 된다.** 그것은 JS `Boolean(v)` 의미여서 비어있지 않은
 * 모든 문자열을 true로 만든다. 환경변수는 항상 문자열이므로 `FLAG=false`조차 true가 되어
 * **스위치를 끌 수 없고**, 그 사실이 런타임에 드러나지 않는다(조용한 오설정).
 *
 * (api의 `config/env.schema.ts`에 동일 헬퍼가 있다. 워커는 DB·api에 무접근인 독립 패키지이고
 * shared는 런타임 의존성 0이라 zod를 두지 않으므로, 3줄 헬퍼는 각 패키지에 둔다.)
 */
const envBoolean = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(defaultValue)
    .transform((v) => v === true || v === 'true');

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
  // MinIO·R2(path-style)=true. R2를 virtual-host 스타일로 쓰려면 false — 이 스위치가 실제로 꺼져야 한다
  S3_FORCE_PATH_STYLE: envBoolean(true),
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
