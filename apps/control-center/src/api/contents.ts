import type {
  Content,
  ContentDetail,
  ContentId,
  ContentListQuery,
  ContentSummary,
  CreateRevisionRequestBody,
  DistributeContentRequest,
  PageQuery,
  Paginated,
  Publication,
  PublicationId,
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

/**
 * POST /v1/contents/:id/distribute — center_approved만. 송출은 승인과 분리된 별도 지시다
 * (reporter_only는 기자 승인이 publishing으로 자동 연쇄하지만, reporter_then_center는
 * 센터 승인 후 여기서 멈춘다 — shared afterReporterApproval).
 * 대상 채널은 서버가 해석한다(content.targetChannelAccountIds → 소속 지사 connected kakao).
 */
export const distributeContent = (
  c: ApiClient,
  id: ContentId,
  body: DistributeContentRequest = {},
): Promise<readonly Publication[]> =>
  c.request<readonly Publication[]>('POST', `/contents/${id}/distribute`, { body });

/** GET /v1/contents/:id/publications — 채널별 송출 결과 */
export const listPublications = (c: ApiClient, id: ContentId): Promise<readonly Publication[]> =>
  c.request<readonly Publication[]>('GET', `/contents/${id}/publications`);

/** POST /v1/publications/:id/retry — 채널 단위 재시도(failed만). Content 상태와 독립 */
export const retryPublication = (c: ApiClient, id: PublicationId): Promise<Publication> =>
  c.request<Publication>('POST', `/publications/${id}/retry`);

/** POST /v1/publications/:id/retract — 송출 후 회수(published만) */
export const retractPublication = (c: ApiClient, id: PublicationId): Promise<Publication> =>
  c.request<Publication>('POST', `/publications/${id}/retract`);
