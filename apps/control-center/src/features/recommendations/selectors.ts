import type {
  RecommendationReview,
  WeeklyRecommendation,
  WeeklyRecommendationId,
} from '@gachinol/shared';
import { toId } from '@gachinol/shared';
import { isApiClientError } from '../../api/errors';

/** 추천 검토 화면 파생 헬퍼 (순수) */

/**
 * rank 오름차순 정렬. 서버가 이미 rank순으로 주지만 표시 순서를 화면이 스스로 보장한다
 * (원본 배열은 readonly라 복사 후 정렬).
 */
export function sortedReviewItems(
  review: Pick<RecommendationReview, 'items'>,
): RecommendationReview['items'] {
  return [...review.items].sort((a, b) => a.item.rank - b.item.rank);
}

/**
 * 점수 표기 — score는 optional이고 "분석 점수 없음"과 0.00은 다른 의미다.
 * 부재(또는 비유한수)는 '—', 존재하면 소수 2자리.
 */
export function formatScore(score?: number): string {
  if (score === undefined || !Number.isFinite(score)) return '—';
  return score.toFixed(2);
}

/**
 * 조인에서 빠진 항목 수 — 콘텐츠 행이 삭제되면 review.items에서 조용히 제외된다(서버 의도된 설계).
 * 원본 recommendation.items와의 차이를 화면에 정직하게 표기하기 위한 값.
 */
export function missingItemCount(review: RecommendationReview): number {
  return Math.max(0, review.recommendation.items.length - review.items.length);
}

/** 항목 수 표기 — 누락이 있으면 'N건 중 M건 표시' */
export function itemCountLabel(review: RecommendationReview): string {
  const total = review.recommendation.items.length;
  const shown = review.items.length;
  return total === shown ? `${total}건` : `${total}건 중 ${shown}건 표시`;
}

/**
 * POST /v1/recommendations 409의 details.id — 기존 주차 행으로 딥링크 유도용.
 * 경합 분기(details 없음)에는 null.
 */
export function conflictRecommendationId(err: unknown): WeeklyRecommendationId | null {
  if (!isApiClientError(err) || err.status !== 409) return null;
  const id = err.error.details?.id;
  return typeof id === 'string' && id.length > 0 ? toId<WeeklyRecommendationId>(id) : null;
}

/** 재생성 여부 — generation ≥ 2면 summary에 수정 지시 접두가 붙어 있다 */
export const isRegenerated = (r: Pick<WeeklyRecommendation, 'generation'>): boolean =>
  r.generation >= 2;
