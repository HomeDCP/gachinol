import type { ContentId, ProgramCategory, StationId } from '@gachinol/shared';

/** 캐시 키는 팩토리로만 생성 — 리터럴 산개 금지 */

/** 피드 필터 — 지사·분류 횡단 (cursor는 무한스크롤 pageParam이라 키에서 제외) */
export interface FeedFilter {
  stationId?: StationId;
  category?: ProgramCategory;
}

/** undefined 제거 + 고정 순서(stationId→category) 정규화 — 같은 필터는 항상 같은 키 */
function normalizeFeedFilter(filter: FeedFilter): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (filter.stationId !== undefined) normalized.stationId = filter.stationId;
  if (filter.category !== undefined) normalized.category = filter.category;
  return normalized;
}

export const feedKeys = {
  /** prefix 앵커 */
  all: ['feed'] as const,
  list: (filter: FeedFilter) => ['feed', 'list', normalizeFeedFilter(filter)] as const,
  playback: (id: ContentId) => ['feed', 'playback', id] as const,
};

export const stationKeys = {
  publicList: ['stations', 'public'] as const,
};
