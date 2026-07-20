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
  sortOrder: z.number().int().min(0),
  foundedAt: zDateOnly.optional(),
}) satisfies ZodSchemaOf<CreateStationRequest>;

export const zUpdateStation = z.object({
  name: z.string().min(1).max(100).optional(),
  region: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  thumbnailUrl: z.string().url().max(2000).optional(),
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
