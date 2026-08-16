import type {
  CreateStationRequest,
  TransitionStationRequest,
  UpdateStationRequest,
} from '@gachinol/shared';
import { StationKind, StationStatus } from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zEnum, zPage } from '../../common/zod';
import type { ZodSchemaOf } from '../../common/zod';

/** 'YYYY-MM-DD' (shared ISODateOnlyString) */
const zDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 한다');

/**
 * 지사 공개 대표번호(T-W2-28) — 숫자·하이픈(선택적 선행 '+')만. `.trim()` 후 `min(1)`이라
 * 빈 문자열·공백만 있는 값은 **저장 경계에서 거부**된다: 빈 값이 저장되면 앱이 "설정됨"으로
 * 오판해 목적지 없는 전화 버튼을 그리게 되므로(이 리포가 Wave 8a에서 반복한 결함) 계약에서 막는다.
 * PII 판정 근거는 shared `Station.supportTel` 주석 참조.
 */
const zSupportTel = z
  .string()
  .trim()
  .min(1, '빈 값은 허용하지 않는다')
  .max(30)
  .regex(/^\+?\d[\d-]*\d$/, '숫자와 하이픈만 허용 (예: 064-000-0000)');

/**
 * 지사 공식 YouTube 채널·라이브 URL — https + youtube 계열 호스트로 제한한다("유튜브에서 보기"
 * 버튼이 유튜브 아닌 곳으로 나가지 않게 하는 하드가드). 공백만 있는 값은 위와 동일하게 거부.
 */
const zYoutubeUrl = z
  .string()
  .trim()
  .min(1, '빈 값은 허용하지 않는다')
  .max(2000)
  .url()
  .refine((v) => {
    let host: string;
    try {
      const parsed = new URL(v);
      if (parsed.protocol !== 'https:') return false;
      host = parsed.hostname.toLowerCase();
    } catch {
      return false;
    }
    return (
      host === 'youtube.com' || host === 'youtu.be' || /\.(youtube\.com|youtu\.be)$/.test(host)
    );
  }, 'https 유튜브 URL이어야 한다 (youtube.com·youtu.be)');

export const zCreateStation = z.object({
  /** unique slug — URL·room 네이밍 키 */
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, '소문자·숫자·하이픈만 허용'),
  name: z.string().min(1).max(100),
  kind: zEnum(StationKind),
  region: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  thumbnailUrl: z.string().url().max(2000).optional(),
  supportTel: zSupportTel.optional(),
  youtubeUrl: zYoutubeUrl.optional(),
  sortOrder: z.number().int().min(0),
  foundedAt: zDateOnly.optional(),
}) satisfies ZodSchemaOf<CreateStationRequest>;

export const zUpdateStation = z.object({
  name: z.string().min(1).max(100).optional(),
  region: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  thumbnailUrl: z.string().url().max(2000).optional(),
  supportTel: zSupportTel.optional(),
  youtubeUrl: zYoutubeUrl.optional(),
  sortOrder: z.number().int().min(0).optional(),
  foundedAt: zDateOnly.optional(),
}) satisfies ZodSchemaOf<UpdateStationRequest>;

export const zStationListQuery = zPage.extend({
  kind: zEnum(StationKind).optional(),
  status: zEnum(StationStatus).optional(),
});

export const zTransitionStation = z.object({
  toStatus: zEnum(StationStatus),
  note: z.string().max(500).optional(),
}) satisfies ZodSchemaOf<TransitionStationRequest>;

export class CreateStationDto extends createZodDto(zCreateStation) {}
export class UpdateStationDto extends createZodDto(zUpdateStation) {}
export class StationListQueryDto extends createZodDto(zStationListQuery) {}
export class TransitionStationDto extends createZodDto(zTransitionStation) {}
