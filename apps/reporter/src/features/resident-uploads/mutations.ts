import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { approveResidentUpload, rejectResidentUpload } from '../../api/resident-uploads';
import type { ResidentUploadReviewItem } from '../../api/resident-uploads';
import { isApiClientError } from '../../api/errors';
import { useApiClient } from '../../auth/auth-context';
import { residentUploadKeys } from '../../query/keys';
import { showToast } from '../../ui/toast';

/**
 * mutation 공통 규칙 — 낙관적 업데이트 금지(리포 관례, contents/mutations.ts와 동형).
 * 승인·반려는 둘 다 되돌릴 수 없는 종결 행위라 낙관적으로 앞서 보여줄 이유가 더더욱 없다 —
 * 서버 응답(또는 invalidate 후 재조회)만이 진실이다.
 *
 * onSuccess/onError를 훅 밖으로 뺀 순수 함수로 둔다 — 이 리포에는 mutation 훅을 렌더 없이
 * 단위 테스트할 도구(@testing-library/react-hooks 등)가 없어서, 실제 QueryClient를 직접 생성해
 * 이 함수만 호출하는 방식으로 invalidate 여부를 검증한다(__tests__/mutations.test.ts).
 */

/** 성공: 큐 전체(prefix) invalidate. item 자체는 쓰지 않는다 — 호출부가 성공 응답으로 다음 화면을 그린다 */
export function onResidentUploadReviewed(
  queryClient: QueryClient,
  _item: ResidentUploadReviewItem,
): void {
  void queryClient.invalidateQueries({ queryKey: residentUploadKeys.all });
}

/** 409(conflict): 큐 invalidate + 토스트 — 동시 검수 경합(다른 담당자가 먼저 처리)의 정상 흐름 */
export function onResidentUploadReviewError(queryClient: QueryClient, err: unknown): void {
  if (isApiClientError(err) && err.status === 409) {
    void queryClient.invalidateQueries({ queryKey: residentUploadKeys.all });
    showToast('상태가 변경되어 목록을 새로고침했습니다');
  }
}

export function useApproveResidentUpload(id: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => approveResidentUpload(client, id),
    onSuccess: (item) => onResidentUploadReviewed(queryClient, item),
    onError: (err) => onResidentUploadReviewError(queryClient, err),
  });
}

export function useRejectResidentUpload(id: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rejectResidentUpload(client, id),
    onSuccess: (item) => onResidentUploadReviewed(queryClient, item),
    onError: (err) => onResidentUploadReviewError(queryClient, err),
  });
}
