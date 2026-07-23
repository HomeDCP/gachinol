import type {
  ChatMessageId,
  CreateLiveSessionRequest,
  LiveIngestInfo,
  LiveSession,
  LiveSessionId,
  LiveSessionStatus,
  Paginated,
  ProgramCategory,
  StationId,
} from '@gachinol/shared';
import type { ApiClient } from './client';

/**
 * 센터 라이브 REST — 경로·바디는 api LiveSessionsController와 정확 일치(Bearer JWT).
 * 목록/상세는 announcer도 허용(서버 Roles). 라이프사이클 전이는 shared LIVE_SESSION_STATUS_TRANSITIONS.
 */

export interface LiveSessionListFilter {
  status?: LiveSessionStatus;
  type?: ProgramCategory;
  hostStationId?: StationId;
  page?: number;
  pageSize?: number;
}

export const createLiveSession = (
  c: ApiClient,
  body: CreateLiveSessionRequest,
): Promise<LiveSession> => c.request<LiveSession>('POST', '/live-sessions', { body });

export const listLiveSessions = (
  c: ApiClient,
  filter: LiveSessionListFilter,
): Promise<Paginated<LiveSession>> =>
  c.request<Paginated<LiveSession>>('GET', '/live-sessions', {
    query: {
      status: filter.status,
      type: filter.type,
      hostStationId: filter.hostStationId,
      page: filter.page,
      pageSize: filter.pageSize,
    },
  });

export const getLiveSession = (c: ApiClient, id: LiveSessionId): Promise<LiveSession> =>
  c.request<LiveSession>('GET', `/live-sessions/${id}`);

/** streamKey 실값이 실리는 유일 엔드포인트 — 요청 시에만 호출(캐시 최소) */
export const getLiveIngest = (c: ApiClient, id: LiveSessionId): Promise<LiveIngestInfo> =>
  c.request<LiveIngestInfo>('GET', `/live-sessions/${id}/ingest`);

/** 라이프사이클 6종 — 빈 바디. 전이 규칙은 서버(shared 맵)가 강제, 클라는 버튼 가용성만 판단 */
export type LiveLifecycleAction = 'prepare' | 'start' | 'interrupt' | 'resume' | 'end' | 'cancel';

export const runLifecycle = (
  c: ApiClient,
  id: LiveSessionId,
  action: LiveLifecycleAction,
): Promise<LiveSession> => c.request<LiveSession>('POST', `/live-sessions/${id}/${action}`, { body: {} });

export const hideChatMessage = (
  c: ApiClient,
  id: LiveSessionId,
  messageId: ChatMessageId,
): Promise<import('@gachinol/shared').ChatMessage> =>
  c.request('POST', `/live-sessions/${id}/chat/${messageId}/hide`, { body: {} });
