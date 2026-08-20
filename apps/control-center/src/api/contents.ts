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
  TransitionContentRequest,
} from '@gachinol/shared';
import type { ApiClient } from './client';

/**
 * GET /v1/contents — 센터는 전 지사 횡단 (stationId로 특정 지사 필터 가능).
 * `minorConsent`는 미성년자 동의 게이트 필터(T-W2-27, 대장 #118) — status로 대체할 수 없다
 * (reviewPolicy='reporter_only'는 센터 검토를 안 거쳐 차단분이 awaiting_reporter_review에 멈춘다).
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
      stationId: q.stationId,
      minorConsent: q.minorConsent,
    },
  });

/** GET /v1/contents/:id — phase-1은 assets·analysis·publications가 파이프라인 진행분만 */
export const getContentDetail = (c: ApiClient, id: ContentId): Promise<ContentDetail> =>
  c.request<ContentDetail>('GET', `/contents/${id}`);

/**
 * POST /v1/contents/:id/minor-consent — 미성년자 피촬영자 법정대리인 동의 **확인** (센터 전용, T-W2-23).
 * 바디 없음. 서버 계약(contents.controller.ts·contents.service.ts 실측):
 *  · `hasMinorSubject=false`면 400 validation_failed (선확인 후 플래그를 켜는 우회 차단)
 *  · 이미 확인된 콘텐츠는 **멱등 200**이며 최초 확인자·시각을 덮어쓰지 않는다(감사 기록 보존)
 *  · 응답은 갱신된 `Content` (status는 바뀌지 않는다 — 이 게이트는 상태와 직교한다)
 */
export const confirmMinorConsent = (c: ApiClient, id: ContentId): Promise<Content> =>
  c.request<Content>('POST', `/contents/${id}/minor-consent`);

/**
 * DELETE /v1/contents/:id/minor-consent — 동의 확인 **철회** (센터 전용).
 * 사유 바디를 받지 않는다(저장할 컬럼이 없다). 서버가 거부하는 두 경우 모두 409다:
 *  · 미확인 상태 ("철회할 대상이 없다")
 *  · **게이트가 지키는 전이가 이미 `status_transition_logs`에 있음** — 철회해도 송출을 막지 못하므로
 *    거짓 안심을 만들지 않기 위해 거부한다. 판정은 `approvedAt`이 아니라 로그 실측이다(D5 정정).
 * 그래서 UI는 `features/contents/actions.ts`의 `minorConsentActionsFor`가 같은 조건을 미리 판정해
 * 버튼 자체를 그리지 않는다 — 이 함수가 호출되는 시점엔 이미 통과 가능해야 한다.
 */
export const withdrawMinorConsent = (c: ApiClient, id: ContentId): Promise<Content> =>
  c.request<Content>('DELETE', `/contents/${id}/minor-consent`);

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
/**
 * POST /v1/contents/:id/regenerate — revision_requested에서 자동편집 재생성 시작(대장 #98).
 * 범용 수동 전이와 다르다: 이 경로만 커밋 후 auto_edit 잡을 인큐한다.
 */
export const regenerateContent = (c: ApiClient, id: ContentId): Promise<Content> =>
  c.request<Content>('POST', `/contents/${id}/regenerate`);

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

/**
 * POST /v1/contents/:id/transitions — 범용 수동 전이(대장 #98). 워커 부재 구간의 임시 탈출구다.
 * 현재 UI 노출은 revision_requested뿐(auto_edit 미구현으로 나가는 코드가 없다) — 전이 대상은
 * `features/contents/actions.ts`의 `manualTransitionTargets`가 shared `CONTENT_STATUS_TRANSITIONS`
 * 에서 파생한다(사본 금지). `to==='revision_requested'`는 서버가 이 엔드포인트에서 거부한다
 * (request-revision 전용 — RevisionRequest 레코드 생성과 같은 트랜잭션이어야 해서).
 */
export const transitionContent = (
  c: ApiClient,
  id: ContentId,
  body: TransitionContentRequest,
): Promise<Content> => c.request<Content>('POST', `/contents/${id}/transitions`, { body });
