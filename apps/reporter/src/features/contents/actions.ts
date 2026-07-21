import type { Content, UserId } from '@gachinol/shared';
import { canTransitionContent, ContentStatus } from '@gachinol/shared';

export interface ReporterActions {
  canEdit: boolean;
  canStartMockUpload: boolean;
  canRetryUpload: boolean;
  canReview: boolean;
  canCancel: boolean;
}

/**
 * 액션 게이팅 — 전이 맵 사본 금지, shared canTransitionContent 재사용.
 * 담당(reporterId === me)이 아니면 전부 false — 지사 동료·live_vod는 열람만.
 */
export function reporterActionsFor(
  content: Pick<Content, 'status' | 'reporterId'>,
  myUserId: UserId,
): ReporterActions {
  const mine = content.reporterId === myUserId;
  return {
    // 서버 EDITABLE(draft·revision_requested) 미러
    canEdit:
      mine &&
      (content.status === ContentStatus.Draft ||
        content.status === ContentStatus.RevisionRequested),
    canStartMockUpload: mine && content.status === ContentStatus.Draft,
    // 서버: 기자는 upload_failed만 재시도 가능 (content-workflow.service 실측)
    canRetryUpload: mine && content.status === ContentStatus.UploadFailed,
    // 승인·수정요청·반려의 관문
    canReview: mine && content.status === ContentStatus.AwaitingReporterReview,
    // shared 전이 맵이 원천
    canCancel: mine && canTransitionContent(content.status, ContentStatus.Canceled),
  };
}
