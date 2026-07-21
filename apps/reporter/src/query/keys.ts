import type { ContentId, ContentStatus, ProgramCategory, StationId } from '@gachinol/shared';

/** 캐시 키는 팩토리로만 생성 — 리터럴 산개 금지 */

export interface ContentListFilter {
  status?: ContentStatus;
  category?: ProgramCategory;
}

/** undefined 제거 + 고정 순서 정규화 — 같은 필터는 항상 같은 키 */
function normalizeFilter(filter: ContentListFilter): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (filter.status !== undefined) normalized.status = filter.status;
  if (filter.category !== undefined) normalized.category = filter.category;
  return normalized;
}

export const contentKeys = {
  /** prefix 앵커 — invalidate 대상 */
  all: ['contents'] as const,
  list: (filter: ContentListFilter) => ['contents', 'list', normalizeFilter(filter)] as const,
  detail: (id: ContentId) => ['contents', 'detail', id] as const,
  logs: (id: ContentId) => ['contents', 'logs', id] as const,
};

export const stationKeys = {
  detail: (id: StationId) => ['stations', 'detail', id] as const,
};

export const authKeys = {
  me: ['auth', 'me'] as const,
};
