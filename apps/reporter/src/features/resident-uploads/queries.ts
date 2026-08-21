import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { Paginated } from '@gachinol/shared';
import { getResidentUpload, listResidentUploads } from '../../api/resident-uploads';
import type { ResidentUploadReviewItem } from '../../api/resident-uploads';
import { useApiClient } from '../../auth/auth-context';
import type { ResidentUploadListFilter } from '../../query/keys';
import { residentUploadKeys } from '../../query/keys';

const PAGE_SIZE = 20;

/** 검수 대기열 무한스크롤 — offset(Paginated) 서버라 page 기반(contents/queries.ts useContentList와 동형) */
export function useResidentUploadQueue(filter: ResidentUploadListFilter) {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: residentUploadKeys.list(filter),
    queryFn: ({ pageParam }) =>
      listResidentUploads(client, { ...filter, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.totalCount ? last.page + 1 : undefined,
  });
}

type ResidentUploadListCache = InfiniteData<Paginated<ResidentUploadReviewItem>>;

/**
 * 목록 캐시에서 항목 찾기 — 이제 **상세의 원천이 아니라 첫 페인트용 시드**다(대장 #120 해소).
 * `useResidentUpload`가 이 값을 `initialData`로 받아 즉시 그리고, 곧바로 서버 단건 조회로 갱신한다.
 *
 * ⚠️ 舊 주석은 "서버에 단건 조회 엔드포인트가 없다(T-W2-24 계약: 목록·승인·반려 3종뿐)"였다 —
 * 2026-08-21 `GET /v1/resident-uploads/:id`가 추가되며 그 전제가 깨졌다.
 *
 * ★ qa-verifier 결함① — 원래는 항목 전체를 `router.push({params})`로 실었는데, expo-router가 그걸
 * 쿼리스트링으로 직렬화해 서버가 "검수자 전용·무인증 표면 노출 금지"로 못 박은 `uploaderContact`가
 * 브라우저 주소창·히스토리에 평문으로 남았다(웹 피벗 확정 — 웹이 주 실행 환경). 캐시 조회는 그 노출
 * 경로 자체가 없다. 캐시에 없으면 null이고, **그때는 목록으로 되돌리는 대신 서버에서 받아온다**
 * (부분 필드만 복구하는 타협은 여전히 하지 않는다 — `consentAgreedAt` 같은 판단 재료가 빠지면
 * fail-open이 된다. 시드는 전부이거나 없거나다).
 *
 * 필터(상태)를 모르는 채로 진입할 수 있으므로(어느 탭에서 눌렀는지) `residentUploadKeys.all` prefix
 * 전체를 뒤진다 — 여러 필터의 캐시된 페이지를 전부 훑어 id로 찾는다.
 */
export function findResidentUploadInCache(
  queryClient: QueryClient,
  id: string,
): ResidentUploadReviewItem | null {
  // ★ `all`이 아니라 `lists()`로 좁힌다 — `all`에는 형태가 다른 `detail` 엔트리(단건 객체)가 함께
  //   걸려 `data.pages`가 undefined가 된다(실제로 크래시했다: `data.pages is not iterable`).
  const cached = queryClient.getQueriesData<ResidentUploadListCache>({
    queryKey: residentUploadKeys.lists(),
  });
  for (const [, data] of cached) {
    // prefix가 좁혀졌어도 방어는 남긴다 — 캐시 형태 가정은 언젠가 또 깨진다
    if (!data || !Array.isArray(data.pages)) continue;
    for (const page of data.pages) {
      const found = page.items?.find((item) => item.id === id);
      if (found) return found;
    }
  }
  return null;
}

/** 네트워크 요청 없음(캐시 전용) — 렌더 시점 스냅숏. 화면 재진입 시 최신 캐시로 다시 계산된다 */
export function useResidentUploadFromCache(id: string): ResidentUploadReviewItem | null {
  const queryClient = useQueryClient();
  return findResidentUploadInCache(queryClient, id);
}

/**
 * 검수 상세 — **서버 단건 조회가 원천**이고 목록 캐시는 첫 페인트 시드일 뿐이다(대장 #120).
 *
 * ★ 이 조합이 요점이다:
 *   - 목록에서 눌러 들어오면 캐시 시드가 있어 **깜빡임 없이 즉시** 그려진다(기존 UX 유지).
 *   - 새로고침·북마크·URL 공유로 바로 들어오면 시드가 없고 서버에서 받아온다 — **舊 구현은 여기서
 *     열리지 않았다.**
 *   - 어느 경로든 마운트 직후 서버 값으로 갱신되므로 **낡은 캐시가 옛 상태를 현재 사실처럼 보여주던
 *     문제**(#120 부수 항목)도 함께 닫힌다.
 *
 * `initialData`에 시드를 넣되 `initialDataUpdatedAt`은 주지 않는다 — 시드를 "방금 받은 신선한 값"으로
 * 취급하면 staleTime 동안 재검증을 건너뛰어, 낡은 캐시를 그대로 굳히게 된다.
 */
export function useResidentUpload(id: string) {
  const client = useApiClient();
  const seed = useResidentUploadFromCache(id);

  return useQuery({
    queryKey: residentUploadKeys.detail(id),
    queryFn: () => getResidentUpload(client, id),
    initialData: seed ?? undefined,
    staleTime: 0,
  });
}
