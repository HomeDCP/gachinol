import { ContentStatus, isFailureStatus } from '@gachinol/shared';
import { centerActionsFor } from '../actions';

describe('centerActionsFor', () => {
  test('awaiting_center_review → canDecide=true, canRetry=false', () => {
    expect(centerActionsFor({ status: 'awaiting_center_review' })).toEqual({
      canDecide: true,
      canRetry: false,
    });
  });

  test('canDecide ⇔ awaiting_center_review, canRetry ⇔ isFailureStatus (전 상태 순회)', () => {
    for (const status of Object.values(ContentStatus)) {
      const a = centerActionsFor({ status });
      expect(a.canDecide).toBe(status === ContentStatus.AwaitingCenterReview);
      expect(a.canRetry).toBe(isFailureStatus(status));
    }
  });

  test('awaiting_reporter_review → 전부 false (기자 전용 액션 미노출)', () => {
    expect(centerActionsFor({ status: 'awaiting_reporter_review' })).toEqual({
      canDecide: false,
      canRetry: false,
    });
  });

  test('종결 3종·draft·published → canDecide=false', () => {
    for (const status of ['rejected', 'canceled', 'archived', 'draft', 'published'] as const) {
      expect(centerActionsFor({ status }).canDecide).toBe(false);
    }
  });

  test('실패 6종 → canRetry=true, canDecide=false', () => {
    for (const status of [
      'upload_failed',
      'processing_failed',
      'analysis_failed',
      'preview_failed',
      'regeneration_failed',
      'publish_failed',
    ] as const) {
      const a = centerActionsFor({ status });
      expect(a.canRetry).toBe(true);
      expect(a.canDecide).toBe(false);
    }
  });
});
