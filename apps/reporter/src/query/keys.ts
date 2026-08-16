import type {
  CaptionFilter,
  ContentId,
  ContentStatus,
  ProgramCategory,
  ResidentUploadStatus,
  StationId,
} from '@gachinol/shared';

/** 캐시 키는 팩토리로만 생성 — 리터럴 산개 금지 */

export interface ContentListFilter {
  status?: ContentStatus;
  category?: ProgramCategory;
  /** 자막 대기열 (T-W2-34) — status와 독립 축이라 캐시 키에도 따로 실린다 */
  captions?: CaptionFilter;
}

/** undefined 제거 + 고정 순서 정규화 — 같은 필터는 항상 같은 키 */
function normalizeFilter(filter: ContentListFilter): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (filter.status !== undefined) normalized.status = filter.status;
  if (filter.category !== undefined) normalized.category = filter.category;
  if (filter.captions !== undefined) normalized.captions = filter.captions;
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

export const systemKeys = {
  /** 미디어 처리 게이트 상태 — DCP 공존 대기 안내 */
  processingState: ['system', 'processing-state'] as const,
};

/** 주민 업로드 검수 대기열 (T-W2-25b) — stationId는 키에 없다: 서버가 강제해 앱이 보내지 않는다 */
export interface ResidentUploadListFilter {
  status?: ResidentUploadStatus;
}

function normalizeResidentUploadFilter(filter: ResidentUploadListFilter): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (filter.status !== undefined) normalized.status = filter.status;
  return normalized;
}

export const residentUploadKeys = {
  /** prefix 앵커 — invalidate 대상 */
  all: ['resident-uploads'] as const,
  list: (filter: ResidentUploadListFilter) =>
    ['resident-uploads', 'list', normalizeResidentUploadFilter(filter)] as const,
};
