import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type {
  CreateLiveSessionRequest,
  LiveSession,
  LiveSessionId,
  Paginated,
} from '@gachinol/shared';
import {
  createLiveSession,
  getLiveSession,
  listLiveSessions,
  runLifecycle,
  type LiveLifecycleAction,
} from '../api/live';
import { useApiClient } from '../auth/auth-context';
import { isApiClientError } from '../api/errors';
import { liveKeys, type LiveSessionFilter } from '../query/keys';
import { showToast } from '../ui/toast';

const LIST_REFETCH_MS = 20 * 1000;

/** 라이브 세션 목록 — status 필터. 진행 상태 추적 위해 짧은 폴링(WS 상태전이 보완) */
export function useLiveSessions(filter: LiveSessionFilter) {
  const client = useApiClient();
  return useQuery<Paginated<LiveSession>>({
    queryKey: liveKeys.list(filter),
    queryFn: () => listLiveSessions(client, { status: filter.status, pageSize: 100 }),
    refetchInterval: LIST_REFETCH_MS,
  });
}

/** 세션 단건 — 상세/관제. WS status_changed가 이후 갱신 트리거 */
export function useLiveSession(id: LiveSessionId) {
  const client = useApiClient();
  return useQuery<LiveSession>({
    queryKey: liveKeys.detail(id),
    queryFn: () => getLiveSession(client, id),
  });
}

function applyResult(queryClient: QueryClient, session: LiveSession): void {
  queryClient.setQueryData(liveKeys.detail(session.id), session);
  void queryClient.invalidateQueries({ queryKey: liveKeys.all });
}

/** 세션 생성 — 성공 시 목록 invalidate */
export function useCreateLiveSession() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLiveSessionRequest) => createLiveSession(client, body),
    onSuccess: (session) => applyResult(queryClient, session),
  });
}

/**
 * 라이프사이클 전이 — 낙관적 업데이트 금지(CAS 409가 정상 흐름).
 * 409(conflict·invalid_transition)면 detail invalidate + 토스트.
 */
export function useLiveLifecycle(id: LiveSessionId) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: LiveLifecycleAction) => runLifecycle(client, id, action),
    onSuccess: (session) => applyResult(queryClient, session),
    onError: (err) => {
      if (isApiClientError(err) && err.status === 409) {
        void queryClient.invalidateQueries({ queryKey: liveKeys.detail(id) });
        showToast('상태가 변경되어 새로고침했습니다');
      }
    },
  });
}
