import type { RecommendationStatus } from '@gachinol/shared';
import { canTransition, RECOMMENDATION_STATUS_TRANSITIONS } from '@gachinol/shared';

/**
 * WeeklyRecommendation 전이 판정 — shared RECOMMENDATION_STATUS_TRANSITIONS가 유일 원천(규칙 사본 금지).
 * RecommendationWorkflowService의 모든 상태 변경은 이 헬퍼로 map-legal 검증 후 CAS한다.
 * (publication-status.ts 동형)
 */
export const canTransitionRecommendation = (
  from: RecommendationStatus,
  to: RecommendationStatus,
): boolean => canTransition(RECOMMENDATION_STATUS_TRANSITIONS, from, to);
