import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type {
  GenerateRecommendationRequest,
  RecommendationReview,
  RequestRecommendationRevision,
  WeeklyRecommendation,
  WeeklyRecommendationId,
} from '@gachinol/shared';
import {
  approveRecommendation,
  generateRecommendation,
  requestRecommendationRevision,
} from '../../api/recommendations';
import { isApiClientError, userMessageForError } from '../../api/errors';
import { useApiClient } from '../../auth/auth-context';
import { recommendationKeys } from '../../query/keys';
import { showToast } from '../../ui/toast';

/**
 * mutation 공통 규칙 — 낙관적 업데이트 금지.
 * 추천 전이도 서버 CAS라 409가 정상 흐름이며 클라 예측 대상이 아니다(contents 선례 동형).
 */

/** 성공: 응답 WeeklyRecommendation을 detail 캐시에 병합 후 ['recommendations'] prefix 전체 invalidate */
function applyRecommendationResult(
  queryClient: QueryClient,
  recommendation: WeeklyRecommendation,
): void {
  queryClient.setQueryData<RecommendationReview>(
    recommendationKeys.detail(recommendation.id),
    (prev) => (prev ? { ...prev, recommendation } : prev),
  );
  void queryClient.invalidateQueries({ queryKey: recommendationKeys.all });
}

/** 409(conflict·invalid_transition): detail invalidate + 토스트 — 정상 경합 흐름 */
function handleTransitionError(
  queryClient: QueryClient,
  id: WeeklyRecommendationId,
  err: unknown,
): void {
  if (isApiClientError(err) && err.status === 409) {
    void queryClient.invalidateQueries({ queryKey: recommendationKeys.detail(id) });
    showToast('상태가 변경되어 새로고침했습니다');
  }
}

/**
 * 주차 추천 생성 트리거. generation_failed 재시도도 같은 엔드포인트다.
 * 409(이미 있음·생성 중)는 목록을 invalidate하고 서버 메시지를 그대로 안내한다
 * — details.id가 있으면 화면이 그 상세로 딥링크를 제안한다(selectors.conflictRecommendationId).
 */
export function useGenerateRecommendation() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GenerateRecommendationRequest) => generateRecommendation(client, body),
    onSuccess: (recommendation) => applyRecommendationResult(queryClient, recommendation),
    onError: (err) => {
      if (isApiClientError(err) && err.status === 409) {
        void queryClient.invalidateQueries({ queryKey: recommendationKeys.all });
        showToast(userMessageForError(err));
      }
    },
  });
}

/** 승인 — 바디 없음. 송출은 자동 연쇄하지 않는다 */
export function useApproveRecommendation(id: WeeklyRecommendationId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => approveRecommendation(client, id),
    onSuccess: (recommendation) => applyRecommendationResult(queryClient, recommendation),
    onError: (err) => handleTransitionError(queryClient, id, err),
  });
}

/** 수정 요청 — 응답은 이미 regenerating(generation +1) */
export function useRequestRecommendationRevision(id: WeeklyRecommendationId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RequestRecommendationRevision) =>
      requestRecommendationRevision(client, id, body),
    onSuccess: (recommendation) => applyRecommendationResult(queryClient, recommendation),
    onError: (err) => handleTransitionError(queryClient, id, err),
  });
}
