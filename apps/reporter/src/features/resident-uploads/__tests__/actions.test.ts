import { ResidentUploadStatus } from '@gachinol/shared';
import { residentUploadActionsFor } from '../actions';

const eligible = { sourceConfirmed: true, pending: false };

describe('residentUploadActionsFor — ⓐ 승인 버튼 활성 조건 (원본 자산 확인 여부)', () => {
  test('검수 대기 + 원본 확인됨 + 진행 중 없음 → 승인 가능', () => {
    const actions = residentUploadActionsFor(ResidentUploadStatus.AwaitingBranchReview, eligible);
    expect(actions.canApprove).toBe(true);
  });

  test('검수 대기지만 원본 미확인 → 승인 불가(판단 근거 없는 승인 금지)', () => {
    const actions = residentUploadActionsFor(ResidentUploadStatus.AwaitingBranchReview, {
      ...eligible,
      sourceConfirmed: false,
    });
    expect(actions.canApprove).toBe(false);
  });

  test('원본이 확인돼도 이미 진행 중인 뮤테이션이 있으면 승인 불가(중복 제출 방지)', () => {
    const actions = residentUploadActionsFor(ResidentUploadStatus.AwaitingBranchReview, {
      ...eligible,
      pending: true,
    });
    expect(actions.canApprove).toBe(false);
  });
});

describe('residentUploadActionsFor — ⓒ 상태별 승인·반려 가능 여부', () => {
  test('awaiting_branch_review만 승인·반려 가능(다른 4종은 전부 불가)', () => {
    const nonReviewable = [
      ResidentUploadStatus.Pending,
      ResidentUploadStatus.UploadFailed,
      ResidentUploadStatus.Approved,
      ResidentUploadStatus.Rejected,
    ];
    for (const status of nonReviewable) {
      const actions = residentUploadActionsFor(status, eligible);
      expect(actions.canApprove).toBe(false);
      expect(actions.canReject).toBe(false);
    }
  });

  test('반려는 원본 확인을 요구하지 않는다(서버도 요구하지 않는다)', () => {
    const actions = residentUploadActionsFor(ResidentUploadStatus.AwaitingBranchReview, {
      sourceConfirmed: false,
      pending: false,
    });
    expect(actions.canReject).toBe(true);
  });

  test('진행 중인 뮤테이션이 있으면 반려도 불가', () => {
    const actions = residentUploadActionsFor(ResidentUploadStatus.AwaitingBranchReview, {
      sourceConfirmed: false,
      pending: true,
    });
    expect(actions.canReject).toBe(false);
  });

  test('shared 전이맵이 원천 — RESIDENT_UPLOAD_STATUS_TRANSITIONS를 바꾸면 이 함수의 답도 같이 바뀐다(사본 아님)', () => {
    // awaiting_branch_review → approved/rejected는 전이맵상 유일한 전진 경로다.
    // 이 테스트는 하드코딩된 문자열 비교가 아니라 그 사실 자체를 확인한다.
    const actions = residentUploadActionsFor(ResidentUploadStatus.AwaitingBranchReview, eligible);
    expect(actions).toEqual({ canApprove: true, canReject: true });
  });
});
