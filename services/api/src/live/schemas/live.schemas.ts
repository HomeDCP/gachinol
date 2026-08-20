import type {
  ChannelAccountId,
  CreateLiveSessionRequest,
  ProductCardInput,
  ProductId,
  StationId,
} from '@gachinol/shared';
import {
  isSafeLinkoutUrl,
  LiveSessionStatus,
  MAX_PRODUCT_CARDS_PER_SESSION,
  PRODUCT_CARD_NAME_MAX,
  PRODUCT_CARD_PRICE_LABEL_MAX,
  ProgramCategory,
} from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zEnum, zId } from '../../common/zod';
import type { ZodSchemaOf } from '../../common/zod';

/**
 * 라이브커머스 1단계 상품 카드 입력 — `id`는 서버 발급이라 받지 않는다.
 *
 * ★ URL 판정을 shared `isSafeLinkoutUrl`에 위임하는 이유: 같은 규칙을 구독자 앱도 렌더 직전에 쓴다
 *   (규칙 사본을 만들면 한쪽만 고쳐져 조용히 어긋난다). `javascript:`·`data:` 차단이 목적이며
 *   **저장 경계에서** 막는다 — 입력 주체가 센터 운영자라도 계정 탈취 한 번이면 공개 화면 전체가 대상이다.
 */
export const zProductCardInput = z.object({
  name: z.string().min(1).max(PRODUCT_CARD_NAME_MAX),
  url: z.string().refine(isSafeLinkoutUrl, {
    message: 'http:// 또는 https:// 로 시작하는 주소만 등록할 수 있습니다',
  }),
  imageUrl: z
    .string()
    .refine(isSafeLinkoutUrl, {
      message: '이미지 주소는 http:// 또는 https:// 로 시작해야 합니다',
    })
    .optional(),
  priceLabel: z.string().max(PRODUCT_CARD_PRICE_LABEL_MAX).optional(),
}) satisfies ZodSchemaOf<ProductCardInput>;

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
  productCards: z.array(zProductCardInput).max(MAX_PRODUCT_CARDS_PER_SESSION).optional(),
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
