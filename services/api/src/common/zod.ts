import type { Brand } from '@gachinol/shared';
import { toId } from '@gachinol/shared';
import { z } from 'zod';

/**
 * shared 계약 정합 강제용 — `satisfies ZodSchemaOf<계약>`.
 * Input을 unknown으로 두어 브랜디드 ID transform(입력 string → 출력 브랜드) 스키마도 허용.
 */
export type ZodSchemaOf<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

/** 브랜디드 ID 입력 — UUID 검증 후 브랜드 복원 (satisfies 정합을 위해 출력 타입을 브랜드로) */
export const zId = <T extends Brand<string, string>>() =>
  z
    .string()
    .uuid()
    .transform((v) => toId<T>(v));

/** shared `as const` 상수 객체 → z.enum — 열거 값 원천 단일화 (사본 금지) */
export const zEnum = <T extends string>(obj: Record<string, T>) =>
  z.enum(Object.values(obj) as [T, ...T[]]);

/**
 * PageQuery — page 기본 1, pageSize 기본 20·최대 100 서버 clamp(거부가 아니라 절삭).
 * 쿼리스트링은 문자열이므로 coerce.
 */
export const zPage = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((v) => Math.min(v, 100)),
});

/**
 * CursorQuery — 커서 기반 무한스크롤(피드·채팅). 리포 최초 커서 계약(zPage와 대칭).
 * cursor는 서버 발급 opaque 문자열(최대 512자). limit 기본 20·최대 100 서버 clamp(거부 아닌 절삭).
 * satisfies 미부착 — coerce/default로 입력≠출력 변성(zPage 선례와 동일).
 */
export const zCursor = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((v) => Math.min(v, 100)),
});
