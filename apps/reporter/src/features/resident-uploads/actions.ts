import { RESIDENT_UPLOAD_STATUS_TRANSITIONS, ResidentUploadStatus } from '@gachinol/shared';

/**
 * 화면 판정 로직을 순수 함수로 분리 — jest.config.js의 testMatch가 `app/`을 배제해 화면
 * 코드는 커버리지 0%다(qa-verifier 결함④). "승인 전 원본 확인 여부"·"상태별 승인·반려 가능 여부"를
 * 여기로 빼서 화면은 이 함수의 결과를 렌더만 하게 한다.
 */
export interface ResidentUploadReviewActions {
  canApprove: boolean;
  canReject: boolean;
}

/** shared 전이맵이 원천 — from→to 허용 여부를 여기서 재정의(하드코딩)하지 않는다(contents/actions.ts reporterActionsFor와 동형) */
function canTransition(from: ResidentUploadStatus, to: ResidentUploadStatus): boolean {
  const allowed: readonly ResidentUploadStatus[] = RESIDENT_UPLOAD_STATUS_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * ⓐ 승인 버튼 활성 조건: 상태가 전이 가능 + **원본 자산이 확인됨**(재생 경로가 서 있어야 판단
 * 근거가 있다고 본다 — 원본 미확인 상태에서 승인 버튼을 살려두지 않는다) + 진행 중 뮤테이션 없음.
 * ⓒ 반려는 원본 확인을 요구하지 않는다(서버도 그렇다 — `reject`는 큐 가용성도 요구하지 않는다).
 */
export function residentUploadActionsFor(
  status: ResidentUploadStatus,
  opts: { sourceConfirmed: boolean; pending: boolean },
): ResidentUploadReviewActions {
  return {
    canApprove:
      canTransition(status, ResidentUploadStatus.Approved) && opts.sourceConfirmed && !opts.pending,
    canReject: canTransition(status, ResidentUploadStatus.Rejected) && !opts.pending,
  };
}
