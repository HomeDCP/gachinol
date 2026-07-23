import type { LiveSessionId, LiveSessionPublic } from '@gachinol/shared';
import type { PublicApiClient } from './client';

/**
 * 공개 라이브 API 호출 (익명 GET). 경로는 api PublicLiveController와 정확 일치.
 * - GET /live/sessions      → LiveSessionPublic[] (bare array, status∈{scheduled,preparing,live,interrupted})
 * - GET /live/sessions/:id  → LiveSessionPublic (ended·canceled는 404)
 * 실시간 채팅·프레즌스·상태전이는 WS(live-socket.ts)가 담당 — REST는 목록·초기 상태만.
 */
export function listLiveSessions(c: PublicApiClient): Promise<readonly LiveSessionPublic[]> {
  return c.get<readonly LiveSessionPublic[]>('/live/sessions');
}

export function getLiveSession(c: PublicApiClient, id: LiveSessionId): Promise<LiveSessionPublic> {
  return c.get<LiveSessionPublic>(`/live/sessions/${id}`);
}
