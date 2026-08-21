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
  /**
   * 목록 전용 앵커 — **`all`과 구분되어야 한다.**
   * 캐시를 직접 훑는 코드(`findResidentUploadInCache`)가 `all`로 조회하면 `detail` 엔트리까지
   * 걸려 들어와 단건 객체를 `InfiniteData`로 오인한다(`data.pages is not iterable`로 실제 크래시).
   * 형태가 다른 캐시가 같은 prefix를 공유하기 시작하면 prefix 조회는 안전하지 않다.
   */
  lists: () => ['resident-uploads', 'list'] as const,
  list: (filter: ResidentUploadListFilter) =>
    ['resident-uploads', 'list', normalizeResidentUploadFilter(filter)] as const,
  /** 단건 조회(대장 #120) — `all` 아래라 승인·반려 후 invalidate가 목록과 함께 무효화한다 */
  detail: (id: string) => ['resident-uploads', 'detail', id] as const,
};
