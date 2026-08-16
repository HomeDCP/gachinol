import type { Content, UserId } from '@gachinol/shared';
import { canTransitionContent, ContentStatus, isCaptionEditableStatus } from '@gachinol/shared';

export interface ReporterActions {
  canEdit: boolean;
  canStartMockUpload: boolean;
  canRetryUpload: boolean;
  canReview: boolean;
  canCancel: boolean;
  /**
   * 사후 자막 보강 (T-W2-34, 대장 #123) — 이 파일에서 **유일하게 `mine`을 요구하지 않는** 액션.
   * 정본 03 §C-4가 자막을 채우는 주체를 촬영자가 아니라 "지사 담당자"로 두었기 때문이다
   * (간단 모드의 존재 이유가 촬영자에게서 자막 부담을 걷어내는 것이라, 소유 기자로 좁히면
   * 목적이 무너진다). 서버도 같은 판정이다 —
   * `ContentsService.updateCaptions` → `loadReadable`(같은 지사면 통과).
   * 기자 앱은 애초에 자기 지사 콘텐츠만 보므로(서버가 목록·상세를 지사로 강제) 화면 쪽 판정에는
   * 상태 조건만 남는다. 상태 규칙의 원천은 shared `isCaptionEditableStatus` 하나다(사본 금지).
   */
  canEditCaptions: boolean;
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
    // ★ mine을 곱하지 않는다 — 위 인터페이스 주석 참조(T-W2-34)
    canEditCaptions: isCaptionEditableStatus(content.status),
  };
}
