import type {
  ContentId,
  ContentStatus,
  LiveSessionId,
  LiveSessionStatus,
  ProgramCategory,
  StationId,
  StationKind,
  StationStatus,
} from '@gachinol/shared';

/** 캐시 키는 팩토리로만 생성 — 리터럴 산개 금지 */

/** 검토 보드 필터 — 센터는 stationId 횡단 필터가 추가된다 */
export interface BoardFilter {
  status?: ContentStatus;
  category?: ProgramCategory;
  stationId?: StationId;
}

/** undefined 제거 + 고정 순서(status→category→stationId) 정규화 — 같은 필터는 항상 같은 키 */
function normalizeFilter(filter: BoardFilter): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (filter.status !== undefined) normalized.status = filter.status;
  if (filter.category !== undefined) normalized.category = filter.category;
  if (filter.stationId !== undefined) normalized.stationId = filter.stationId;
  return normalized;
}

export interface StationFilter {
  kind?: StationKind;
  status?: StationStatus;
}

function normalizeStationFilter(filter: StationFilter): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (filter.kind !== undefined) normalized.kind = filter.kind;
  if (filter.status !== undefined) normalized.status = filter.status;
  return normalized;
}

export const contentKeys = {
  /** prefix 앵커 — invalidate 대상 */
  all: ['contents'] as const,
  list: (filter: BoardFilter) => ['contents', 'list', normalizeFilter(filter)] as const,
  detail: (id: ContentId) => ['contents', 'detail', id] as const,
  logs: (id: ContentId) => ['contents', 'logs', id] as const,
};

export const stationKeys = {
  list: (filter: StationFilter) => ['stations', 'list', normalizeStationFilter(filter)] as const,
  detail: (id: StationId) => ['stations', 'detail', id] as const,
};

export const mediaKeys = {
  accessUrl: (id: string) => ['media-access-url', id] as const,
};

export const authKeys = {
  me: ['auth', 'me'] as const,
};

export interface LiveSessionFilter {
  status?: LiveSessionStatus;
}

function normalizeLiveFilter(filter: LiveSessionFilter): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (filter.status !== undefined) normalized.status = filter.status;
  return normalized;
}

export const liveKeys = {
  all: ['live-sessions'] as const,
  list: (filter: LiveSessionFilter) =>
    ['live-sessions', 'list', normalizeLiveFilter(filter)] as const,
  detail: (id: LiveSessionId) => ['live-sessions', 'detail', id] as const,
  ingest: (id: LiveSessionId) => ['live-sessions', 'ingest', id] as const,
};
