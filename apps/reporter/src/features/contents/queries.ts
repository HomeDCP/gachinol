import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ContentDetail, ContentId, Station, StationId } from '@gachinol/shared';
import { CaptionFilter } from '@gachinol/shared';
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

/**
 * 자막 대기열 건수 (T-W2-34, 대장 #123) — 목록 화면 상단 진입 카드의 숫자.
 *
 * 왜 별도 쿼리인가: 필터를 켜야만 보이는 대기열은 **발견되지 않는다**(자막이 없다는 사실을
 * 이미 아는 사람만 필터를 켠다 — 대장 #118과 같은 형태의 결함). 항상 보이는 자리에 건수를
 * 띄워야 "채울 게 있다"가 스스로 드러난다. `pageSize:1`로 `totalCount`만 받는다
 * (목록 본문은 같은 필터의 칩이 담당하며, 캐시 키가 달라 서로 간섭하지 않는다).
 */
export function useCaptionNeededCount() {
  const client = useApiClient();
  const filter: ContentListFilter = { captions: CaptionFilter.Needed };
  return useQuery({
    queryKey: [...contentKeys.list(filter), 'count'] as const,
    queryFn: () => listContents(client, { ...filter, page: 1, pageSize: 1 }),
    select: (page) => page.totalCount,
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
