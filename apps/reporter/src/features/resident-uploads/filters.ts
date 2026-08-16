import { ResidentUploadStatus } from '@gachinol/shared';
import type { ResidentUploadListFilter } from '../../query/keys';

/**
 * 필터 칩 — 단일 선택. contents 화면과 달리 '전체'가 없다: 서버가 상태 미지정 시
 * `awaiting_branch_review`로 강제 대입할 뿐 "전 상태 통합 조회"를 지원하지 않는다
 * (`resident-review.schemas.ts` — status는 5종 중 하나 또는 생략, 생략=대기열 기본값).
 * 검수 화면의 주 용도(대기열 처리)에 맞춰 검수 이력을 확인하는 2종을 보조로 둔다.
 */
export const RESIDENT_UPLOAD_FILTERS: readonly {
  label: string;
  status: ResidentUploadStatus;
}[] = [
  { label: '검수 대기', status: 'awaiting_branch_review' },
  { label: '승인됨', status: 'approved' },
  { label: '반려됨', status: 'rejected' },
];

/** 칩 index → 쿼리 필터. 범위 밖 index는 기본(대기열)으로 수렴 */
export function residentUploadFilterFromIndex(index: number): ResidentUploadListFilter {
  const status = RESIDENT_UPLOAD_FILTERS[index]?.status ?? ResidentUploadStatus.AwaitingBranchReview;
  return { status };
}
