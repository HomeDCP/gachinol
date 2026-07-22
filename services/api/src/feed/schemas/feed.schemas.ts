import type { StationId } from '@gachinol/shared';
import { ProgramCategory } from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { zCursor, zEnum, zId } from '../../common/zod';

/**
 * GET /v1/feed 쿼리 — 커서 + 지사·분류 필터. 파라미터명 camelCase, enum 값은 snake_case.
 * satisfies 미부착(zCursor coerce/default 변성 — zPage 선례). 반환형은 서버 매퍼로 보장.
 */
export const zFeedQuery = zCursor.extend({
  stationId: zId<StationId>().optional(),
  category: zEnum(ProgramCategory).optional(),
});

export class FeedQueryDto extends createZodDto(zFeedQuery) {}
