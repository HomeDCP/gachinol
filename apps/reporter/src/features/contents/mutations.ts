import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type {
  CancelContentRequest,
  Content,
  ContentDetail,
  ContentId,
  CreateContentDraftRequest,
  CreateRevisionRequestBody,
  RejectContentRequest,
  UpdateContentCaptionsRequest,
  UpdateContentDraftRequest,
} from '@gachinol/shared';
import {
  approveContent,
  cancelContent,
  createDraft,
  rejectContent,
  requestRevision,
  retryContent,
  updateCaptions,
  updateDraft,
} from '../../api/contents';
import { useApiClient } from '../../auth/auth-context';
import { isApiClientError } from '../../api/errors';
import { contentKeys } from '../../query/keys';
import { showToast } from '../../ui/toast';

/**
 * mutation 공통 규칙 — 낙관적 업데이트 금지.
 * 승인은 서버 트랜잭션 자동 연쇄로 결과 상태가 클라 예측 대상이 아니고, CAS 409가 정상 흐름.
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

export function useCreateDraft() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateContentDraftRequest) => createDraft(client, body),
    onSuccess: (content) => applyContentResult(queryClient, content),
  });
}

export function useUpdateDraft(id: ContentId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateContentDraftRequest) => updateDraft(client, id, body),
    onSuccess: (content) => applyContentResult(queryClient, content),
    onError: (err) => handleTransitionError(queryClient, id, err),
  });
}

/**
 * 사후 자막 보강 (T-W2-34, 대장 #123) — `useUpdateDraft`와 별도 훅인 이유는 엔드포인트·허용
 * 상태·액터가 다르기 때문이다(api `ContentsService.updateCaptions` 주석).
 * 성공 시 `contentKeys.all` invalidate가 자막 대기열 목록(`captions=needed`)까지 함께 갱신한다 —
 * 자막을 채운 항목이 대기열에서 사라지는 것이 이 경로의 눈에 보이는 결과다.
 */
export function useUpdateCaptions(id: ContentId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateContentCaptionsRequest) => updateCaptions(client, id, body),
    onSuccess: (content) => applyContentResult(queryClient, content),
    onError: (err) => handleTransitionError(queryClient, id, err),
  });
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

export function useCancel(id: ContentId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CancelContentRequest) => cancelContent(client, id, body),
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
