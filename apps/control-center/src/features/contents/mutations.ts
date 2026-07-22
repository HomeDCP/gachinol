import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type {
  Content,
  ContentDetail,
  ContentId,
  CreateRevisionRequestBody,
  RejectContentRequest,
} from '@gachinol/shared';
import { approveContent, rejectContent, requestRevision, retryContent } from '../../api/contents';
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
