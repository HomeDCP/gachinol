import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ContentDetail, ContentId, Station, StationId } from '@gachinol/shared';
import { getContentDetail, listContents, listTransitionLogs } from '../../api/contents';
import { getStation } from '../../api/stations';
import { useApiClient } from '../../auth/auth-context';
import { contentKeys, stationKeys } from '../../query/keys';
import type { ContentListFilter } from '../../query/keys';
import { isAutoProgressStatus } from './status';

const PAGE_SIZE = 20;

/**
 * 목록 무한스크롤 — 판정 ①: 서버는 offset(Paginated) — page 기반 useInfiniteQuery.
 * 서버가 커서 페이지네이션을 제공하면 이 파일만 교체한다.
 */
export function useContentList(filter: ContentListFilter) {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: contentKeys.list(filter),
    queryFn: ({ pageParam }) =>
      listContents(client, { ...filter, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.totalCount ? last.page + 1 : undefined,
  });
}

/**
 * 상세 조회. poll=true(화면 포커스 시)면 자동 진행 상태에서 15s 폴링 — WS 미도입 MVP의 대안.
 */
export function useContentDetail(id: ContentId, opts?: { poll?: boolean }) {
  const client = useApiClient();
  const poll = opts?.poll ?? false;
  return useQuery({
    queryKey: contentKeys.detail(id),
    queryFn: () => getContentDetail(client, id),
    refetchInterval: poll
      ? (query) => {
          const status = (query.state.data as ContentDetail | undefined)?.content.status;
          return status && isAutoProgressStatus(status) ? 15_000 : false;
        }
      : false,
  });
}

/** 전이 이력 (최신순) — [더 보기]로 다음 page */
export function useTransitionLogs(id: ContentId) {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: contentKeys.logs(id),
    queryFn: ({ pageParam }) =>
      listTransitionLogs(client, id, { page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.totalCount ? last.page + 1 : undefined,
  });
}

/** 소속 지사 — 이름은 사실상 불변, staleTime Infinity */
export function useStation(id: StationId) {
  const client = useApiClient();
  return useQuery<Station>({
    queryKey: stationKeys.detail(id),
    queryFn: () => getStation(client, id),
    staleTime: Infinity,
  });
}
