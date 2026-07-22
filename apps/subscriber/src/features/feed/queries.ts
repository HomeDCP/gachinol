import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ContentId, CursorPage, FeedItem, StationSummary } from '@gachinol/shared';
import { getPlayback, listFeed, listPublicStations } from '../../api/feed';
import { useApiClient } from '../../api-context';
import { feedKeys, stationKeys, type FeedFilter } from '../../query/keys';

const PAGE_LIMIT = 20;
/** 서명 재생 URL TTL(서버 DOWNLOAD_URL_TTL_SEC=900s)보다 짧게 — 만료 전 재발급 유도 */
const PLAYBACK_STALE_MS = 5 * 60 * 1000;
const STATION_STALE_MS = 5 * 60 * 1000;

/** 순수 헬퍼 — 커서 소진 시 undefined(무한스크롤 종료) */
export function getNextPageParam(last: CursorPage<FeedItem>): string | undefined {
  return last.nextCursor ?? undefined;
}

/** 피드 무한스크롤 — 커서 기반(offset 아님)이라 페이지 경계 중복이 없다(dedupe 불요) */
export function useFeedInfinite(filter: FeedFilter) {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: feedKeys.list(filter),
    queryFn: ({ pageParam }) =>
      listFeed(client, { ...filter, cursor: pageParam, limit: PAGE_LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam,
  });
}

/** 재생 정보 — staleTime을 서명 TTL보다 짧게 잡아 URL 만료 전 재요청 */
export function usePlayback(id: ContentId) {
  const client = useApiClient();
  return useQuery({
    queryKey: feedKeys.playback(id),
    queryFn: () => getPlayback(client, id),
    staleTime: PLAYBACK_STALE_MS,
  });
}

/** 공개 지사 목록 — 운영·휴무 지사만(서버 필터) */
export function usePublicStations() {
  const client = useApiClient();
  return useQuery<readonly StationSummary[]>({
    queryKey: stationKeys.publicList,
    queryFn: () => listPublicStations(client),
    staleTime: STATION_STALE_MS,
  });
}
