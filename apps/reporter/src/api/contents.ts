import type {
  CancelContentRequest,
  Content,
  ContentDetail,
  ContentId,
  ContentListQuery,
  ContentSummary,
  CreateContentDraftRequest,
  CreateRevisionRequestBody,
  PageQuery,
  Paginated,
  RejectContentRequest,
  StatusTransitionLog,
  UpdateContentCaptionsRequest,
  UpdateContentDraftRequest,
} from '@gachinol/shared';
import type { ApiClient } from './client';

/**
 * GET /v1/contents — reporter는 서버가 자기 지사 강제 (stationId 전송 안 함).
 * `captions=needed`는 자막 대기열 필터(T-W2-34, 대장 #123) — 간단 모드·주민 제보로 자막 없이
 * 들어온 콘텐츠 중 **아직 채울 수 있는 것**만 온다(판정 원천은 shared `CaptionFilter`).
 */
export const listContents = (
  c: ApiClient,
  q: ContentListQuery,
): Promise<Paginated<ContentSummary>> =>
  c.request<Paginated<ContentSummary>>('GET', '/contents', {
    query: {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      category: q.category,
      captions: q.captions,
    },
  });

/** GET /v1/contents/:id — phase-1은 assets·analysis·publications 항상 빈 값 */
export const getContentDetail = (c: ApiClient, id: ContentId): Promise<ContentDetail> =>
  c.request<ContentDetail>('GET', `/contents/${id}`);

/** POST /v1/contents — stationId·reporterId는 토큰에서 (바디 금지) */
export const createDraft = (c: ApiClient, body: CreateContentDraftRequest): Promise<Content> =>
  c.request<Content>('POST', '/contents', { body });

/** PATCH /v1/contents/:id — draft·revision_requested만 (위반 409 conflict) */
export const updateDraft = (
  c: ApiClient,
  id: ContentId,
  body: UpdateContentDraftRequest,
): Promise<Content> => c.request<Content>('PATCH', `/contents/${id}`, { body });

/**
 * PATCH /v1/contents/:id/captions — 사후 자막 보강 (T-W2-34, 대장 #123).
 * `updateDraft`와 달리 **같은 지사 기자면 담당이 아니어도** 되고 `published` 직전까지 열려 있다.
 * 대신 자막(scenes)만 보낼 수 있다. 타 지사 403 · 송출·종결 이후 409.
 */
export const updateCaptions = (
  c: ApiClient,
  id: ContentId,
  body: UpdateContentCaptionsRequest,
): Promise<Content> => c.request<Content>('PATCH', `/contents/${id}/captions`, { body });

/** POST /v1/contents/:id/approve — 응답은 자동 연쇄 후 최종 상태(publishing 또는 awaiting_center_review) */
export const approveContent = (c: ApiClient, id: ContentId): Promise<Content> =>
  c.request<Content>('POST', `/contents/${id}/approve`);

/** POST /v1/contents/:id/request-revision — revision_requested 전이의 유일 경로 */
export const requestRevision = (
  c: ApiClient,
  id: ContentId,
  body: CreateRevisionRequestBody,
): Promise<Content> => c.request<Content>('POST', `/contents/${id}/request-revision`, { body });

/** POST /v1/contents/:id/reject — 종결, 사유 필수 */
export const rejectContent = (
  c: ApiClient,
  id: ContentId,
  body: RejectContentRequest,
): Promise<Content> => c.request<Content>('POST', `/contents/${id}/reject`, { body });

/** POST /v1/contents/:id/cancel — 전이 맵상 canceled 가능 상태 전부 */
export const cancelContent = (
  c: ApiClient,
  id: ContentId,
  body: CancelContentRequest,
): Promise<Content> => c.request<Content>('POST', `/contents/${id}/cancel`, { body });

/**
 * POST /v1/contents/:id/regenerate — revision_requested에서 자동편집 재생성을 시작한다.
 * 서버가 커밋 후 auto_edit 잡을 인큐한다(대장 #98). 수정요청과 자동 연쇄하지 않는 이유는
 * `features/contents/actions.ts`의 canRegenerate 주석 참조.
 */
export const regenerateContent = (c: ApiClient, id: ContentId): Promise<Content> =>
  c.request<Content>('POST', `/contents/${id}/regenerate`);

/** POST /v1/contents/:id/retry — 기자는 upload_failed만 (그 외 403) */
export const retryContent = (c: ApiClient, id: ContentId): Promise<Content> =>
  c.request<Content>('POST', `/contents/${id}/retry`);

/** GET /v1/contents/:id/transition-logs — 최신순 */
export const listTransitionLogs = (
  c: ApiClient,
  id: ContentId,
  q: PageQuery,
): Promise<Paginated<StatusTransitionLog>> =>
  c.request<Paginated<StatusTransitionLog>>('GET', `/contents/${id}/transition-logs`, {
    query: { page: q.page, pageSize: q.pageSize },
  });
