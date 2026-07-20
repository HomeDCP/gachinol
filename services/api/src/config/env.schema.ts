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
    // 이번 단계 미사용 — compose 정합 확인용 (BullMQ·업로드 단계 예약)
    REDIS_URL: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
  })
  .refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET, {
    message: 'access/refresh 시크릿은 서로 달라야 한다',
  });

export type Env = z.infer<typeof envSchema>;
