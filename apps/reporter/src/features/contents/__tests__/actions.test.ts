import { ContentStatus, canTransitionContent, toId } from '@gachinol/shared';
import type { UserId } from '@gachinol/shared';
import { reporterActionsFor } from '../actions';

const ME = toId<UserId>('user-me');
const OTHER = toId<UserId>('user-other');

const mine = (status: ContentStatus) => ({ status, reporterId: ME });
const theirs = (status: ContentStatus) => ({ status, reporterId: OTHER });

describe('reporterActionsFor', () => {
  test('담당 + awaiting_reporter_review → canReview·canCancel', () => {
    const a = reporterActionsFor(mine('awaiting_reporter_review'), ME);
    expect(a).toEqual({
      canEdit: false,
      canStartMockUpload: false,
      canRetryUpload: false,
      canReview: true,
      canCancel: true,
    });
  });

  test('비담당은 전부 false (지사 동료·live_vod는 열람만)', () => {
    for (const status of Object.values(ContentStatus)) {
      const a = reporterActionsFor(theirs(status), ME);
      expect(Object.values(a).every((v) => v === false)).toBe(true);
    }
    // live_vod: reporterId=null
    const a = reporterActionsFor({ status: 'awaiting_reporter_review', reporterId: null }, ME);
    expect(Object.values(a).every((v) => v === false)).toBe(true);
  });

  test('upload_failed → canRetryUpload (기자 유일 재시도 권한)', () => {
    const a = reporterActionsFor(mine('upload_failed'), ME);
    expect(a.canRetryUpload).toBe(true);
    expect(a.canReview).toBe(false);
    // 그 외 실패 상태는 재시도 불가 (센터 몫)
    expect(reporterActionsFor(mine('processing_failed'), ME).canRetryUpload).toBe(false);
    expect(reporterActionsFor(mine('publish_failed'), ME).canRetryUpload).toBe(false);
  });

  test('revision_requested → canEdit / draft → canEdit + canStartMockUpload', () => {
    expect(reporterActionsFor(mine('revision_requested'), ME).canEdit).toBe(true);
    expect(reporterActionsFor(mine('revision_requested'), ME).canStartMockUpload).toBe(false);
    const draft = reporterActionsFor(mine('draft'), ME);
    expect(draft.canEdit).toBe(true);
    expect(draft.canStartMockUpload).toBe(true);
  });

  test('awaiting_center_review → 전부 false (canceled 출구 없음)', () => {
    const a = reporterActionsFor(mine('awaiting_center_review'), ME);
    expect(Object.values(a).every((v) => v === false)).toBe(true);
  });

  test('종결 3종 전부 false', () => {
    for (const status of ['rejected', 'canceled', 'archived'] as const) {
      const a = reporterActionsFor(mine(status), ME);
      expect(Object.values(a).every((v) => v === false)).toBe(true);
    }
  });

  test('canCancel — shared canTransitionContent 결과와 전 상태 일치 (맵 순회)', () => {
    for (const status of Object.values(ContentStatus)) {
      expect(reporterActionsFor(mine(status), ME).canCancel).toBe(
        canTransitionContent(status, ContentStatus.Canceled),
      );
    }
  });
});
