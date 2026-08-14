import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  ContentDetail,
  ContentId,
  MediaAccessUrl,
  MediaAssetId,
  Publication,
} from '@gachinol/shared';
import {
  getContentDetail,
  listContents,
  listPublications,
  listTransitionLogs,
} from '../../api/contents';
import { getMediaAccessUrl } from '../../api/media';
import { useApiClient } from '../../auth/auth-context';
import { contentKeys, mediaKeys } from '../../query/keys';
import type { BoardFilter } from '../../query/keys';
import { isAutoProgressStatus } from './status';

const PAGE_SIZE = 20;

/**
 * 검토 보드 무한스크롤 — 서버는 offset(Paginated) — page 기반 useInfiniteQuery.
 * 센터는 stationId 횡단 필터가 유효(무필터=전 지사).
 */
export function useContentBoard(filter: BoardFilter) {
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

/** 프리뷰 자산의 서명 GET URL — 자산 준비 전엔 비활성(enabled=false) */
export function useMediaAccessUrl(assetId: MediaAssetId | undefined) {
  const client = useApiClient();
  return useQuery<MediaAccessUrl>({
    queryKey: mediaKeys.accessUrl(assetId ?? 'none'),
    queryFn: () => getMediaAccessUrl(client, assetId!),
    enabled: assetId != null,
    // 서명 URL 만료(DOWNLOAD_URL_TTL_SEC 기본 900s) 전에 재발급되도록 짧게
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * 채널별 송출 결과. 송출은 비동기(큐)라 지시 직후엔 queued뿐이므로, 진행 중(queued/publishing)이
 * 하나라도 있으면 5s 폴링한다 — 상세의 15s 폴링(자동 진행 상태)보다 촘촘해야 채널 단위 결과가
 * 제때 보인다. Content가 published여도 개별 채널은 failed일 수 있어 상태만으로는 판정할 수 없다.
 */
export function usePublications(id: ContentId, opts?: { poll?: boolean }) {
  const client = useApiClient();
  const poll = opts?.poll ?? false;
  return useQuery<readonly Publication[]>({
    queryKey: contentKeys.publications(id),
    queryFn: () => listPublications(client, id),
    refetchInterval: poll
      ? (query) => {
          const rows = query.state.data as readonly Publication[] | undefined;
          const inFlight = rows?.some((p) => p.status === 'queued' || p.status === 'publishing');
          return inFlight ? 5_000 : false;
        }
      : false,
  });
}
