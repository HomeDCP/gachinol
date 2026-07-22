import type {
  ContentId,
  CursorPage,
  FeedItem,
  FeedQuery,
  PlaybackInfo,
  StationSummary,
} from '@gachinol/shared';
import type { PublicApiClient } from './client';

/**
 * 공개 피드 API 호출 (익명 GET). 경로·파라미터는 api feed.controller와 정확 일치.
 * - GET /feed              → CursorPage<FeedItem>
 * - GET /feed/:id/playback → PlaybackInfo
 * - GET /feed/stations     → StationSummary[] (bare array)
 */
export function listFeed(c: PublicApiClient, q: FeedQuery): Promise<CursorPage<FeedItem>> {
  return c.get<CursorPage<FeedItem>>('/feed', {
    query: { cursor: q.cursor, limit: q.limit, stationId: q.stationId, category: q.category },
  });
}

export function getPlayback(c: PublicApiClient, id: ContentId): Promise<PlaybackInfo> {
  return c.get<PlaybackInfo>(`/feed/${id}/playback`);
}

export function listPublicStations(c: PublicApiClient): Promise<readonly StationSummary[]> {
  return c.get<readonly StationSummary[]>('/feed/stations');
}
