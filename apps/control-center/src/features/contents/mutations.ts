import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type {
  Content,
  ContentDetail,
  ContentId,
  CreateRevisionRequestBody,
  Publication,
  PublicationId,
  RejectContentRequest,
  TransitionContentRequest,
} from '@gachinol/shared';
import {
  approveContent,
  distributeContent,
  rejectContent,
  requestRevision,
  retractPublication,
  retryContent,
  retryPublication,
  transitionContent,
} from '../../api/contents';
import { useApiClient } from '../../auth/auth-context';
import { isApiClientError } from '../../api/errors';
import { contentKeys } from '../../query/keys';
import { showToast } from '../../ui/toast';

/**
 * mutation 공통 규칙 — 낙관적 업데이트 금지.
 * 센터 결정은 CAS(409)가 정상 흐름이라 클라 예측 대상이 아니다.
 */

/** 성공: 응답 Content를 detail 캐시에 병합 후 ['contents'] prefix 전체 invalidate */
function applyContentResult(queryClient: QueryClient, content: Content): void {
  queryClient.setQueryData<ContentDetail>(contentKeys.detail(content.id), (prev) =>
    prev ? { ...prev, content } : prev,
  );
  void queryClient.invalidateQueries({ queryKey: contentKeys.all });
}

/** 409(conflict·invalid_transition): detail·logs invalidate + 토스트 — 정상 경합 흐름 */
function handleTransitionError(queryClient: QueryClient, id: ContentId, err: unknown): void {
  if (isApiClientError(err) && err.status === 409) {
    void queryClient.invalidateQueries({ queryKey: contentKeys.detail(id) });
    void queryClient.invalidateQueries({ queryKey: contentKeys.logs(id) });
    showToast('상태가 변경되어 새로고침했습니다');
  }
}

export function useApprove(id: ContentId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => approveContent(client, id),
    onSuccess: (content) => applyContentResult(queryClient, content),
    onError: (err) => handleTransitionError(queryClient, id, err),
  });
}

export function useRequestRevision(id: ContentId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRevisionRequestBody) => requestRevision(client, id, body),
    onSuccess: (content) => applyContentResult(queryClient, content),
    onError: (err) => handleTransitionError(queryClient, id, err),
  });
}

export function useReject(id: ContentId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RejectContentRequest) => rejectContent(client, id, body),
    onSuccess: (content) => applyContentResult(queryClient, content),
    onError: (err) => handleTransitionError(queryClient, id, err),
  });
}

export function useRetry(id: ContentId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => retryContent(client, id),
    onSuccess: (content) => applyContentResult(queryClient, content),
    onError: (err) => handleTransitionError(queryClient, id, err),
  });
}

/**
 * 범용 수동 전이(대장 #98) — auto_edit 워커 부재로 자동 진행 코드가 없는 상태의 탈출구.
 * 대상은 호출부(`app/(app)/contents/[id].tsx`)가 `centerActionsFor().manualTransitionTargets`
 * (shared 파생)에서만 골라 전달한다 — 여기서 목적지를 검증하지 않는다(서버 assertAllowed가 최종 관문).
 */
export function useTransitionContent(id: ContentId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TransitionContentRequest) => transitionContent(client, id, body),
    onSuccess: (content) => applyContentResult(queryClient, content),
    onError: (err) => handleTransitionError(queryClient, id, err),
  });
}

/**
 * 송출 지시 — center_approved → publishing(서버 CAS) + 채널별 Publication queued.
 * 응답은 Content가 아니라 Publication[]이라 detail 병합 대상이 없다 → prefix 전체 invalidate로
 * 상태·송출 결과를 함께 다시 읽는다(송출은 비동기라 즉시 published가 아니다).
 */
export function useDistribute(id: ContentId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => distributeContent(client, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contentKeys.all });
    },
    onError: (err) => handleTransitionError(queryClient, id, err),
  });
}

/** 채널 단위 재시도 — Content 상태와 독립(일부 채널만 실패한 경우의 복구 경로) */
export function useRetryPublication(contentId: ContentId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (publicationId: PublicationId) => retryPublication(client, publicationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contentKeys.all });
    },
    onError: (err) => handleTransitionError(queryClient, contentId, err),
  });
}

/** 송출 회수 — published Publication만. 되돌리기 어려우므로 호출부가 확인 다이얼로그를 건다 */
export function useRetractPublication(contentId: ContentId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<Publication, unknown, PublicationId>({
    mutationFn: (publicationId: PublicationId) => retractPublication(client, publicationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contentKeys.all });
    },
    onError: (err) => handleTransitionError(queryClient, contentId, err),
  });
}
