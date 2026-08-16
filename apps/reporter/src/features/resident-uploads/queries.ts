import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { Paginated } from '@gachinol/shared';
import { listResidentUploads } from '../../api/resident-uploads';
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
 * 상세 화면 데이터 원천 — 서버에 단건 조회 엔드포인트가 없다(T-W2-24 계약: 목록·승인·반려 3종뿐,
 * `resident-reviews.controller.ts` 실측). 그래서 원문을 라우트 파라미터로 들고 가는 대신 **목록 쿼리
 * 캐시에서 조회한다**.
 *
 * ★ qa-verifier 결함① — 원래는 항목 전체를 `router.push({params})`로 실었는데, expo-router가 그걸
 * 쿼리스트링으로 직렬화해 서버가 "검수자 전용·무인증 표면 노출 금지"로 못 박은 `uploaderContact`가
 * 브라우저 주소창·히스토리에 평문으로 남았다(웹 피벗 확정 — 웹이 주 실행 환경). 캐시 조회는 그 노출
 * 경로 자체가 없다. 캐시에 없으면(새로고침·딥링크·북마크) null — 호출부가 상세를 열지 않고 목록으로
 * 안내한다(부분 필드만 복구하는 타협도 하지 않는다 — `consentAgreedAt` 같은 판단 재료가 빠지면
 * fail-open이 된다).
 *
 * 필터(상태)를 모르는 채로 진입할 수 있으므로(어느 탭에서 눌렀는지) `residentUploadKeys.all` prefix
 * 전체를 뒤진다 — 여러 필터의 캐시된 페이지를 전부 훑어 id로 찾는다.
 */
export function findResidentUploadInCache(
  queryClient: QueryClient,
  id: string,
): ResidentUploadReviewItem | null {
  const cached = queryClient.getQueriesData<ResidentUploadListCache>({
    queryKey: residentUploadKeys.all,
  });
  for (const [, data] of cached) {
    if (!data) continue;
    for (const page of data.pages) {
      const found = page.items.find((item) => item.id === id);
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
