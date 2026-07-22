import type {
  Content,
  ContentDetail,
  ContentId,
  ContentListQuery,
  ContentSummary,
  CreateRevisionRequestBody,
  PageQuery,
  Paginated,
  RejectContentRequest,
  StatusTransitionLog,
} from '@gachinol/shared';
import type { ApiClient } from './client';

/** GET /v1/contents — 센터는 전 지사 횡단 (stationId로 특정 지사 필터 가능) */
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
      stationId: q.stationId,
    },
  });

/** GET /v1/contents/:id — phase-1은 assets·analysis·publications가 파이프라인 진행분만 */
export const getContentDetail = (c: ApiClient, id: ContentId): Promise<ContentDetail> =>
  c.request<ContentDetail>('GET', `/contents/${id}`);

/** POST /v1/contents/:id/approve — 센터: awaiting_center_review → center_approved (송출은 Distribute 몫) */
export const approveContent = (c: ApiClient, id: ContentId): Promise<Content> =>
  c.request<Content>('POST', `/contents/${id}/approve`);

/** POST /v1/contents/:id/request-revision — revision_requested 전이의 유일 경로. requesterRole은 서버가 인증 role로 판정 */
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

/** POST /v1/contents/:id/retry — 센터는 실패 6종 재시도 (목적지는 shared CONTENT_RETRY_TARGET) */
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
