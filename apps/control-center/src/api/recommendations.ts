import type {
  GenerateRecommendationRequest,
  Paginated,
  PageQuery,
  RecommendationReview,
  RecommendationStatus,
  RequestRecommendationRevision,
  WeeklyRecommendation,
  WeeklyRecommendationId,
} from '@gachinol/shared';
import type { ApiClient } from './client';

/**
 * 주간 추천 — 센터 전용 5종. 전 엔드포인트 @Roles('center_operator','admin')이라
 * 기자·구독자 토큰은 403. 인증은 기존 ApiClient(refresh single-flight·401 1회 재시도)가 담당.
 */

/**
 * POST /v1/recommendations — HttpCode 200(201 아님).
 * weekOf는 주중 아무 날짜여도 서버가 그 주 월요일(KST)로 정규화한다.
 * 응답 status는 `generating`(큐 경로) 또는 이미 `pending_review`(인라인 폴백 경로) 둘 다 정상.
 * 같은 주차 재요청은 멱등 분기 — generation_failed면 200(재시도), 그 외 기존 행이면 409(details.id 동봉).
 */
export const generateRecommendation = (
  c: ApiClient,
  body: GenerateRecommendationRequest,
): Promise<WeeklyRecommendation> =>
  c.request<WeeklyRecommendation>('POST', '/recommendations', { body });

/** GET /v1/recommendations — weekOf 내림차순. pageSize는 서버 clamp(최대 100) */
export const listRecommendations = (
  c: ApiClient,
  q: PageQuery & { status?: RecommendationStatus },
): Promise<Paginated<WeeklyRecommendation>> =>
  c.request<Paginated<WeeklyRecommendation>>('GET', '/recommendations', {
    query: { page: q.page, pageSize: q.pageSize, status: q.status },
  });

/**
 * GET /v1/recommendations/:id — 검토 화면.
 * items는 rank 오름차순이며 삭제된 콘텐츠는 조용히 빠진다
 * → `items.length < recommendation.items.length`가 정상 가능(화면에 누락 경고 표기).
 */
export const getRecommendationReview = (
  c: ApiClient,
  id: WeeklyRecommendationId,
): Promise<RecommendationReview> =>
  c.request<RecommendationReview>('GET', `/recommendations/${id}`);

/** POST /v1/recommendations/:id/approve — 바디 없음. 승인은 송출을 자동 연쇄하지 않는다(후속 배선) */
export const approveRecommendation = (
  c: ApiClient,
  id: WeeklyRecommendationId,
): Promise<WeeklyRecommendation> =>
  c.request<WeeklyRecommendation>('POST', `/recommendations/${id}/approve`);

/**
 * POST /v1/recommendations/:id/request-revision — 응답 status는 이미 `regenerating`
 * (revision_requested는 서버 2홉 자동 연쇄라 중간 상태로 노출되지 않는다). generation은 +1.
 * note는 서버가 파싱하지 않는다 — 매직 토큰 금지.
 */
export const requestRecommendationRevision = (
  c: ApiClient,
  id: WeeklyRecommendationId,
  body: RequestRecommendationRevision,
): Promise<WeeklyRecommendation> =>
  c.request<WeeklyRecommendation>('POST', `/recommendations/${id}/request-revision`, { body });
