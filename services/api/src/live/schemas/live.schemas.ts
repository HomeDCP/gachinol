import type {
  ChannelAccountId,
  CreateLiveSessionRequest,
  ProductId,
  StationId,
} from '@gachinol/shared';
import { LiveSessionStatus, ProgramCategory } from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zEnum, zId } from '../../common/zod';
import type { ZodSchemaOf } from '../../common/zod';

/**
 * 라이브 생성 요청 — 불변식(type='emergency' ⇔ scheduledAt=null)은 서비스가 최종 검증한다
 * (초기 상태 판정은 type만 사용 — initialLiveStatus). 여기선 형태만 강제.
 */
export const zCreateLiveSession = z.object({
  type: zEnum(ProgramCategory),
  title: z.string().min(1).max(200),
  scheduledAt: z.string().datetime().nullable(),
  hostStationId: zId<StationId>().optional(),
  targetChannelAccountIds: z.array(zId<ChannelAccountId>()).default([]),
  productIds: z.array(zId<ProductId>()).optional(),
}) satisfies ZodSchemaOf<CreateLiveSessionRequest>;

export class CreateLiveSessionDto extends createZodDto(zCreateLiveSession) {}

/** 라이프사이클(prepare/start/interrupt/resume/end/cancel) 바디 — note는 감사용 optional */
export const zLiveLifecycle = z.object({
  note: z.string().max(500).optional(),
});
export class LiveLifecycleDto extends createZodDto(zLiveLifecycle) {}

/** 채팅 숨김 바디 — 빈 바디 허용(향후 사유 예약) */
export const zHideChat = z.object({
  note: z.string().max(500).optional(),
});
export class HideChatDto extends createZodDto(zHideChat) {}

/** GET /live-sessions 목록 필터 — status/type/hostStationId + offset 페이지 */
export const zLiveSessionListQuery = z.object({
  status: zEnum(LiveSessionStatus).optional(),
  type: zEnum(ProgramCategory).optional(),
  hostStationId: zId<StationId>().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((v) => Math.min(v, 100)),
});
export class LiveSessionListQueryDto extends createZodDto(zLiveSessionListQuery) {}
