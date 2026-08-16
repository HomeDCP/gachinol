import type { Station, StationId, StationKind, StationStatus } from '@gachinol/shared';
import { toId } from '@gachinol/shared';
import type { Station as StationRow } from '@prisma/client';

/** row → shared Station (경계 캐스팅 유일 지점) */
export const toStation = (row: StationRow): Station => ({
  id: toId<StationId>(row.id),
  code: row.code,
  name: row.name,
  kind: row.kind as StationKind,
  status: row.status as StationStatus,
  region: row.region,
  description: row.description ?? undefined,
  thumbnailUrl: row.thumbnailUrl ?? undefined,
  supportTel: row.supportTel ?? undefined,
  youtubeUrl: row.youtubeUrl ?? undefined,
  sortOrder: row.sortOrder,
  foundedAt: row.foundedAt ? row.foundedAt.toISOString().slice(0, 10) : undefined,
  dormantSince: row.dormantSince ? row.dormantSince.toISOString() : undefined,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
