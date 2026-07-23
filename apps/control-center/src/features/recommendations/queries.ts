import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { RecommendationReview, WeeklyRecommendationId } from '@gachinol/shared';
import { getRecommendationReview, listRecommendations } from '../../api/recommendations';
import { useApiClient } from '../../auth/auth-context';
import { recommendationKeys } from '../../query/keys';
import type { RecommendationFilter } from '../../query/keys';
import { isAutoProgressRecommendationStatus } from './status';

const PAGE_SIZE = 20;
/** 큐 경로에서 생성이 비동기라 상태가 수 초 뒤 바뀐다 — useContentDetail 폴링 선례 동형 */
const POLL_INTERVAL_MS = 10_000;

/** 주차 목록 무한스크롤 — 서버는 offset(Paginated)이라 page 기반 */
export function useRecommendationList(filter: RecommendationFilter) {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: recommendationKeys.list(filter),
    queryFn: ({ pageParam }) =>
      listRecommendations(client, { ...filter, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.totalCount ? last.page + 1 : undefined,
  });
}

/**
 * 검토 상세. poll=true(화면 포커스 시)면 generating·regenerating 동안 10s 폴링.
 * 서버 기록 순서 규약상 pending_review가 보이면 items는 반드시 채워져 있다.
 */
export function useRecommendationReview(
  id: WeeklyRecommendationId,
  opts?: { poll?: boolean },
) {
  const client = useApiClient();
  const poll = opts?.poll ?? false;
  return useQuery({
    queryKey: recommendationKeys.detail(id),
    queryFn: () => getRecommendationReview(client, id),
    refetchInterval: poll
      ? (query) => {
          const status = (query.state.data as RecommendationReview | undefined)?.recommendation
            .status;
          return status && isAutoProgressRecommendationStatus(status) ? POLL_INTERVAL_MS : false;
        }
      : false,
  });
}
