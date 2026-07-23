import type {
  ContentId,
  GenerateRecommendationRequest,
  RecommendationItem,
  RequestRecommendationRevision,
} from '@gachinol/shared';
import { RecommendationStatus } from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zEnum, zId, zPage } from '../../common/zod';
import type { ZodSchemaOf } from '../../common/zod';
import { isDateOnly } from '../week';

/**
 * POST /v1/recommendations — 주중 아무 날짜 허용(서버가 그 주 월요일로 정규화).
 * ★ 형식뿐 아니라 **실존 날짜**까지 여기서 거부한다: '2026-02-31'을 통과시키면 서비스의
 *   parseDateOnly가 생 Error를 던져 클라 입력 오류가 500 internal로 오분류된다(400 validation_failed여야).
 */
export const zGenerateRecommendation = z.object({
  weekOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다')
    .refine(isDateOnly, '존재하지 않는 날짜입니다'),
}) satisfies ZodSchemaOf<GenerateRecommendationRequest>;

/** POST /v1/recommendations/:id/request-revision */
export const zRequestRecommendationRevision = z.object({
  note: z.string().min(1).max(2000),
}) satisfies ZodSchemaOf<RequestRecommendationRevision>;

/** weekly_recommendations.items JSONB의 읽기/쓰기 경계 스키마 — wire RecommendationItem 그대로 */
export const zRecommendationItem = z.object({
  contentId: zId<ContentId>(),
  rank: z.number().int().min(1),
  score: z.number().min(0).max(1).optional(),
  reason: z.string(),
  highlights: z
    .array(z.object({ startSec: z.number().min(0), endSec: z.number().min(0) }))
    .optional(),
}) satisfies ZodSchemaOf<RecommendationItem>;

/**
 * items 배열 — rank는 1부터 연속·중복 금지(DB 제약 대신 앱 경계에서 강제).
 * contents.scenes order refine 선례 동형.
 */
export const zRecommendationItems = z.array(zRecommendationItem).superRefine((items, ctx) => {
  const ranks = items.map((i) => i.rank).sort((a, b) => a - b);
  if (ranks.some((r, i) => r !== i + 1)) {
    ctx.addIssue({ code: 'custom', message: 'rank는 1부터 연속·중복 금지' });
  }
  if (new Set(items.map((i) => i.contentId)).size !== items.length) {
    ctx.addIssue({ code: 'custom', message: 'items의 contentId는 중복될 수 없습니다' });
  }
});

/** GET /v1/recommendations — zPage 확장(satisfies 미부착: coerce/default 변성, zContentListQuery 선례) */
export const zRecommendationListQuery = zPage.extend({
  status: zEnum(RecommendationStatus).optional(),
});

export class GenerateRecommendationDto extends createZodDto(zGenerateRecommendation) {}
export class RequestRecommendationRevisionDto extends createZodDto(
  zRequestRecommendationRevision,
) {}
export class RecommendationListQueryDto extends createZodDto(zRecommendationListQuery) {}
