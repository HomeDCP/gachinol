import type {
  ContentId,
  ContentStatus,
  LiveSessionId,
  LiveSessionStatus,
  MinorConsentFilter,
  ProgramCategory,
  RecommendationStatus,
  StationId,
  StationKind,
  StationStatus,
  WeeklyRecommendationId,
} from '@gachinol/shared';

/** 캐시 키는 팩토리로만 생성 — 리터럴 산개 금지 */

/** 검토 보드 필터 — 센터는 stationId 횡단 필터가 추가된다 */
export interface BoardFilter {
  status?: ContentStatus;
  category?: ProgramCategory;
  stationId?: StationId;
  /** 미성년자 동의 게이트 — status와 직교한다 (T-W2-27, 대장 #118) */
  minorConsent?: MinorConsentFilter;
}

/**
 * undefined 제거 + 고정 순서(status→category→stationId→minorConsent) 정규화 — 같은 필터는 항상
 * 같은 키. 새 조회 파라미터를 여기에 빠뜨리면 **서로 다른 조회가 같은 캐시를 공유해** 엉뚱한 목록이
 * 보인다(키는 조회 파라미터 전수를 담아야 한다).
 */
function normalizeFilter(filter: BoardFilter): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (filter.status !== undefined) normalized.status = filter.status;
  if (filter.category !== undefined) normalized.category = filter.category;
  if (filter.stationId !== undefined) normalized.stationId = filter.stationId;
  if (filter.minorConsent !== undefined) normalized.minorConsent = filter.minorConsent;
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
  /** 채널별 송출 결과 — contents prefix 하위라 전이 invalidate에 함께 걸린다 */
  publications: (id: ContentId) => ['contents', 'publications', id] as const,
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

/** 주간 추천 목록 필터 — 서버 status는 단일 값 계약 */
export interface RecommendationFilter {
  status?: RecommendationStatus;
}

function normalizeRecommendationFilter(filter: RecommendationFilter): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (filter.status !== undefined) normalized.status = filter.status;
  return normalized;
}

export const recommendationKeys = {
  /** prefix 앵커 — 전이 후 invalidate 대상 */
  all: ['recommendations'] as const,
  list: (filter: RecommendationFilter) =>
    ['recommendations', 'list', normalizeRecommendationFilter(filter)] as const,
  detail: (id: WeeklyRecommendationId) => ['recommendations', 'detail', id] as const,
};

export const liveKeys = {
  all: ['live-sessions'] as const,
  list: (filter: LiveSessionFilter) =>
    ['live-sessions', 'list', normalizeLiveFilter(filter)] as const,
  detail: (id: LiveSessionId) => ['live-sessions', 'detail', id] as const,
  ingest: (id: LiveSessionId) => ['live-sessions', 'ingest', id] as const,
};
