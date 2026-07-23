import { useQuery } from '@tanstack/react-query';
import type { LiveSessionId, LiveSessionPublic } from '@gachinol/shared';
import { getLiveSession, listLiveSessions } from '../api/live';
import { useApiClient } from '../api-context';
import { liveKeys } from '../query/keys';

/** 공개 라이브 목록 — 예정·준비·방송중·일시중단. 방송중 감지 위해 짧은 폴링(WS 상태전이 보완) */
const LIVE_LIST_REFETCH_MS = 30 * 1000;

export function useLiveSessions() {
  const client = useApiClient();
  return useQuery<readonly LiveSessionPublic[]>({
    queryKey: liveKeys.sessions,
    queryFn: () => listLiveSessions(client),
    refetchInterval: LIVE_LIST_REFETCH_MS,
  });
}

/** 라이브 단건(초기 상태) — WS 조인 ack의 session이 이후 진실원. 상세 진입 초기 렌더용 */
export function useLiveSession(id: LiveSessionId) {
  const client = useApiClient();
  return useQuery<LiveSessionPublic>({
    queryKey: liveKeys.session(id),
    queryFn: () => getLiveSession(client, id),
  });
}
