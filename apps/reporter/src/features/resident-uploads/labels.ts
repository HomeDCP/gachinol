import type { ResidentUploadStatus } from '@gachinol/shared';
import type { BadgeToneName } from '../../ui/theme';

export interface ResidentUploadStatusBadge {
  label: string;
  tone: BadgeToneName;
}

/**
 * 5종 전수 — satisfies Record로 강제(상태 추가 시 tsc가 잡는다, contents/status.ts STATUS_BADGE와 동형).
 * pending·upload_failed는 완료 통지 전 상태라 검수 화면에는 거의 나타나지 않지만, 링크가 만료되지
 * 않은 채 badge 조회가 들어올 가능성을 배제하지 않는다(예: 라우트 파라미터로 넘어온 스냅샷이 오래됨).
 */
export const RESIDENT_UPLOAD_STATUS_BADGE = {
  pending: { label: '업로드 대기', tone: 'neutral' },
  upload_failed: { label: '업로드 실패', tone: 'danger' },
  awaiting_branch_review: { label: '검수 대기', tone: 'warning' },
  approved: { label: '승인됨', tone: 'success' },
  rejected: { label: '반려됨', tone: 'danger' },
} as const satisfies Record<ResidentUploadStatus, ResidentUploadStatusBadge>;

export const residentUploadStatusBadge = (s: ResidentUploadStatus): ResidentUploadStatusBadge =>
  RESIDENT_UPLOAD_STATUS_BADGE[s];
