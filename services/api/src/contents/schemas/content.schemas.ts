import type {
  CancelContentRequest,
  ChannelAccountId,
  ContentId,
  CreateContentDraftRequest,
  CreateRevisionRequestBody,
  DistributeContentRequest,
  RejectContentRequest,
  Scene,
  SceneId,
  SceneInput,
  StationId,
  TransitionContentRequest,
  UpdateContentDraftRequest,
} from '@gachinol/shared';
import {
  ContentStatus,
  CultureTopic,
  MinorConsentFilter,
  ProgramCategory,
  requiresCultureTopic,
} from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zEnum, zId, zPage } from '../../common/zod';
import type { ZodSchemaOf } from '../../common/zod';

export const zSceneInput = z.object({
  order: z.number().int().min(0),
  caption: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  startSec: z.number().min(0).nullable(),
  endSec: z.number().min(0).nullable(),
}) satisfies ZodSchemaOf<SceneInput>;

/** contents.scenes JSONB의 읽기/쓰기 경계 스키마 — wire Scene 그대로(키 camelCase) */
export const zScene = z.object({
  id: zId<SceneId>(),
  order: z.number().int().min(0),
  caption: z.string(),
  description: z.string().optional(),
  startSec: z.number().nullable(),
  endSec: z.number().nullable(),
  thumbnailUrl: z.string().optional(),
}) satisfies ZodSchemaOf<Scene>;

/** scene order 0부터 연속·중복 금지 */
const checkSceneOrders = (scenes: readonly { order: number }[], ctx: z.RefinementCtx): void => {
  const orders = [...scenes].map((s) => s.order).sort((a, b) => a - b);
  if (orders.some((o, i) => o !== i)) {
    ctx.addIssue({
      code: 'custom',
      path: ['scenes'],
      message: 'scene order는 0부터 연속·중복 금지',
    });
  }
};

export const zCreateContentDraft = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    category: zEnum(ProgramCategory),
    cultureTopics: z.array(zEnum(CultureTopic)).optional(),
    scenes: z.array(zSceneInput).max(200),
    /** 피촬영자 중 만 14세 미만 존재 여부 — 미전송 시 false (T-W2-23) */
    hasMinorSubject: z.boolean().optional(),
    /** 반려/취소 콘텐츠 재작업 원본 — 실재·상태·지사 검증은 서비스 계층(contents.service.ts) */
    remakeOfContentId: zId<ContentId>().optional(),
  })
  .superRefine((v, ctx) => {
    // 서버 불변식 — shared 순수 헬퍼가 검증 규칙의 원천
    if (requiresCultureTopic(v.category) && !v.cultureTopics?.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['cultureTopics'],
        message: "category='culture'는 cultureTopics 1개 이상 필수",
      });
    }
    if (!requiresCultureTopic(v.category) && v.cultureTopics?.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['cultureTopics'],
        message: 'culture 외 분류는 cultureTopics 금지',
      });
    }
    checkSceneOrders(v.scenes, ctx);
  }) satisfies ZodSchemaOf<CreateContentDraftRequest>; // ★ shared 계약 정합을 tsc가 강제

export const zUpdateContentDraft = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    category: zEnum(ProgramCategory).optional(),
    cultureTopics: z.array(zEnum(CultureTopic)).optional(),
    scenes: z.array(zSceneInput).max(200).optional(),
    /** 피촬영자 중 만 14세 미만 존재 여부 — true→false 시 서버가 확인 기록도 함께 지운다(T-W2-23) */
    hasMinorSubject: z.boolean().optional(),
    targetChannelAccountIds: z.array(zId<ChannelAccountId>()).max(50).optional(),
  })
  .superRefine((v, ctx) => {
    // culture↔cultureTopics 상호 불변식은 기존 값과 병합 후 서비스에서 최종 검증
    if (v.scenes) checkSceneOrders(v.scenes, ctx);
  }) satisfies ZodSchemaOf<UpdateContentDraftRequest>;

export const zContentListQuery = zPage.extend({
  status: zEnum(ContentStatus).optional(),
  category: zEnum(ProgramCategory).optional(),
  /** 관제 공용 — reporter는 서버가 자기 소속으로 덮어씀 */
  stationId: zId<StationId>().optional(),
  /**
   * 미성년자 동의 게이트 필터 (T-W2-27, 대장 #118) — 값은 shared `MinorConsentFilter`가 원천.
   * status와 직교한다(차단된 콘텐츠의 상태가 reviewPolicy마다 다르다).
   */
  minorConsent: zEnum(MinorConsentFilter).optional(),
});

export const zTransitionContent = z.object({
  toStatus: zEnum(ContentStatus),
  note: z.string().max(500).optional(),
}) satisfies ZodSchemaOf<TransitionContentRequest>;

export const zRejectContent = z.object({
  note: z.string().min(1).max(2000),
}) satisfies ZodSchemaOf<RejectContentRequest>;

export const zCancelContent = z.object({
  note: z.string().max(2000).optional(),
}) satisfies ZodSchemaOf<CancelContentRequest>;

/** POST /v1/contents/:id/distribute — 대상 채널 override(생략 시 서버 해석). 빈 바디 허용 */
export const zDistributeContent = z.object({
  channelAccountIds: z.array(zId<ChannelAccountId>()).max(50).optional(),
}) satisfies ZodSchemaOf<DistributeContentRequest>;

export const zCreateRevisionRequestBody = z.object({
  note: z.string().min(1).max(2000),
  sceneNotes: z
    .array(z.object({ sceneId: zId<SceneId>(), note: z.string().min(1).max(1000) }))
    .max(200)
    .optional(),
}) satisfies ZodSchemaOf<CreateRevisionRequestBody>;

export class DistributeContentDto extends createZodDto(zDistributeContent) {}
export class CreateContentDraftDto extends createZodDto(zCreateContentDraft) {}
export class UpdateContentDraftDto extends createZodDto(zUpdateContentDraft) {}
export class ContentListQueryDto extends createZodDto(zContentListQuery) {}
export class TransitionContentDto extends createZodDto(zTransitionContent) {}
export class RejectContentDto extends createZodDto(zRejectContent) {}
export class CancelContentDto extends createZodDto(zCancelContent) {}
export class CreateRevisionRequestDto extends createZodDto(zCreateRevisionRequestBody) {}
export class PageQueryDto extends createZodDto(zPage) {}
