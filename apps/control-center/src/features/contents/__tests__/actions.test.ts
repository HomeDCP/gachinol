import { CONTENT_STATUS_TRANSITIONS, ContentStatus, isFailureStatus } from '@gachinol/shared';
import { centerActionsFor } from '../actions';

describe('centerActionsFor', () => {
  test('awaiting_center_review → canDecide=true, canRetry=false', () => {
    expect(centerActionsFor({ status: 'awaiting_center_review' })).toEqual({
      canDecide: true,
      canRetry: false,
      canDistribute: false,
      manualTransitionTargets: [],
    });
  });

  test('canDecide ⇔ awaiting_center_review, canRetry ⇔ isFailureStatus, canDistribute ⇔ center_approved (전 상태 순회)', () => {
    for (const status of Object.values(ContentStatus)) {
      const a = centerActionsFor({ status });
      expect(a.canDecide).toBe(status === ContentStatus.AwaitingCenterReview);
      expect(a.canRetry).toBe(isFailureStatus(status));
      expect(a.canDistribute).toBe(status === ContentStatus.CenterApproved);
    }
  });

  test('center_approved → canDistribute만 true (승인과 송출은 분리된 지시)', () => {
    expect(centerActionsFor({ status: 'center_approved' })).toEqual({
      canDecide: false,
      canRetry: false,
      canDistribute: true,
      manualTransitionTargets: [],
    });
  });

  test('세 액션은 상호배타 — 한 상태에서 둘 이상 동시에 참이 되지 않는다', () => {
    for (const status of Object.values(ContentStatus)) {
      const a = centerActionsFor({ status });
      const on = [a.canDecide, a.canRetry, a.canDistribute].filter(Boolean).length;
      expect(on).toBeLessThanOrEqual(1);
    }
  });

  test('awaiting_reporter_review → 전부 false (기자 전용 액션 미노출)', () => {
    expect(centerActionsFor({ status: 'awaiting_reporter_review' })).toEqual({
      canDecide: false,
      canRetry: false,
      canDistribute: false,
      manualTransitionTargets: [],
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
      expect(a.canDistribute).toBe(false);
    }
  });
});

/**
 * manualTransitionTargets (대장 #98) — revision_requested의 유일한 진행 수단.
 * shared CONTENT_STATUS_TRANSITIONS에서 파생(사본 금지) — 서버 맵이 바뀌면 이 테스트가 실측한다.
 */
describe('centerActionsFor — manualTransitionTargets', () => {
  test('revision_requested → shared CONTENT_STATUS_TRANSITIONS.revision_requested와 정확히 동일', () => {
    expect(centerActionsFor({ status: 'revision_requested' }).manualTransitionTargets).toEqual(
      CONTENT_STATUS_TRANSITIONS.revision_requested,
    );
    // 실측 고정 — 맵이 조용히 바뀌면(예: canceled 제거) 이 단언이 잡는다
    expect(centerActionsFor({ status: 'revision_requested' }).manualTransitionTargets).toEqual([
      'regenerating',
      'canceled',
    ]);
  });

  test('revision_requested 외 22종은 전부 빈 배열 — 다른 정지 상태는 canRetry/canDecide가 이미 진행 경로를 제공', () => {
    for (const status of Object.values(ContentStatus)) {
      if (status === ContentStatus.RevisionRequested) continue;
      expect(centerActionsFor({ status }).manualTransitionTargets).toEqual([]);
    }
  });

  test('manualTransitionTargets가 있으면 canDecide·canRetry·canDistribute는 전부 false (탈출구 중복 없음)', () => {
    const a = centerActionsFor({ status: 'revision_requested' });
    expect(a.manualTransitionTargets.length).toBeGreaterThan(0);
    expect(a.canDecide).toBe(false);
    expect(a.canRetry).toBe(false);
    expect(a.canDistribute).toBe(false);
  });
});
