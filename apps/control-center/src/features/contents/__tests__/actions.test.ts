import {
  CONTENT_STATUS_TRANSITIONS,
  ContentStatus,
  isAutoProgressContentStatus,
  isFailureStatus,
} from '@gachinol/shared';
import { centerActionsFor } from '../actions';

describe('centerActionsFor', () => {
  test('awaiting_center_review → canDecide=true, canRetry=false', () => {
    expect(centerActionsFor({ status: 'awaiting_center_review' })).toEqual({
      canDecide: true,
      canRetry: false,
      canDistribute: false,
      canRegenerate: false,
      canArchive: false,
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
      canRegenerate: false,
      canArchive: false,
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
      canRegenerate: false,
      canArchive: false,
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
  /* ★ 대장 #98 종결 후 — revision_requested의 탈출구는 **전용 액션으로 옮겨갔다**.
   * auto_edit 구동으로 regenerating이 자동 진행 상태가 되면서 ③ 조건("나가는 길 끝에 자동 진행
   * 상태가 없다")에 걸려 범용 수동 전이가 닫혔고, 그 자리를 canRegenerate가 채운다.
   * 이것이 옳은 이유: 범용 전이(POST /transitions)는 auto_edit 잡을 **인큐하지 않아** 그 길로
   * 가면 또 멈춘다. 진짜 경로는 POST /regenerate뿐이다. */
  test('revision_requested → 범용 탈출구는 닫히고 canRegenerate가 연다 (auto_edit 구동 후)', () => {
    const a = centerActionsFor({ status: 'revision_requested' });
    expect(a.manualTransitionTargets).toEqual([]);
    expect(a.canRegenerate).toBe(true);
    // 전이 맵상 regenerating은 여전히 합법 — 닫힌 것은 '범용 전이 노출'이지 전이 자체가 아니다
    expect(CONTENT_STATUS_TRANSITIONS.revision_requested).toContain('regenerating');
  });

  /** ★ 대장 #124 — published에서 보관 경로가 실제로 나온다(등재 시 0건이었다) */
  test('published → shared CONTENT_STATUS_TRANSITIONS.published와 정확히 동일 = 보관 경로', () => {
    expect(centerActionsFor({ status: 'published' }).manualTransitionTargets).toEqual(
      CONTENT_STATUS_TRANSITIONS.published,
    );
    // 실측 고정 — published의 유일한 합법 출구가 archived다
    expect(centerActionsFor({ status: 'published' }).manualTransitionTargets).toEqual(['archived']);
    expect(centerActionsFor({ status: 'published' }).canArchive).toBe(true);
  });

  test('canArchive ⇔ 목적지에 archived가 있다 (전 상태 순회) — 현재 published 1종뿐', () => {
    const withArchive: string[] = [];
    for (const status of Object.values(ContentStatus)) {
      const a = centerActionsFor({ status });
      expect(a.canArchive).toBe(a.manualTransitionTargets.includes(ContentStatus.Archived));
      if (a.canArchive) withArchive.push(status);
    }
    expect(withArchive).toEqual([ContentStatus.Published]);
  });

  test('published 외 22종은 전부 빈 배열 — 나머지는 전용 액션(canRetry·canDecide·canRegenerate)이 담당', () => {
    const open: string[] = [];
    for (const status of Object.values(ContentStatus)) {
      const targets = centerActionsFor({ status }).manualTransitionTargets;
      if (targets.length > 0) open.push(status);
    }
    // revision_requested는 auto_edit 구동 후 canRegenerate로 옮겨갔다(대장 #98)
    expect(open).toEqual([ContentStatus.Published]);
  });

  /**
   * ★ 게이트가 상태 이름 목록이 아니라 **파생 술어**임을 고정한다(T-W2-32).
   * 이 두 단언이 무너지면 누군가 상태 이름을 하드코딩했거나 무차별로 열었다는 뜻이다.
   */
  test('목적지가 열린 상태의 출구에는 자동 진행 상태가 하나도 없다 (다른 액터가 밟는 길은 열지 않는다)', () => {
    for (const status of Object.values(ContentStatus)) {
      const targets = centerActionsFor({ status }).manualTransitionTargets;
      if (targets.length === 0) continue;
      expect(isAutoProgressContentStatus(status)).toBe(false);
      for (const to of targets) expect(isAutoProgressContentStatus(to)).toBe(false);
    }
  });

  test('출구에 자동 진행 상태가 하나라도 있으면 닫힌다 — draft(→uploading)·awaiting_reporter_review(→reporter_approved)', () => {
    for (const status of [
      ContentStatus.Draft,
      ContentStatus.AwaitingReporterReview,
    ] as const) {
      const exits: readonly ContentStatus[] = CONTENT_STATUS_TRANSITIONS[status];
      expect(exits.some(isAutoProgressContentStatus)).toBe(true); // 전제가 참인지부터 실측
      expect(centerActionsFor({ status }).manualTransitionTargets).toEqual([]);
    }
  });

  test('manualTransitionTargets가 있으면 전용 액션은 전부 false (탈출구 중복 없음)', () => {
    for (const status of [ContentStatus.Published] as const) {
      const a = centerActionsFor({ status });
      expect(a.manualTransitionTargets.length).toBeGreaterThan(0);
      expect(a.canDecide).toBe(false);
      expect(a.canRetry).toBe(false);
      expect(a.canDistribute).toBe(false);
      expect(a.canRegenerate).toBe(false);
    }
  });

  test('역도 성립 — 전용 액션이 있으면 범용 탈출구는 닫힌다 (revision_requested 포함)', () => {
    for (const status of Object.values(ContentStatus)) {
      const a = centerActionsFor({ status });
      if (a.canDecide || a.canRetry || a.canDistribute || a.canRegenerate) {
        expect(a.manualTransitionTargets).toEqual([]);
      }
    }
  });
});

// (이력) 舊 minorConsentGateEdge/GateState/ActionsFor 스위트(T-W2-32·대장 #130)는
// 판정부와 함께 T-W2-36으로 제거 — 앱은 동의서 수취를 판단하지 않는다.
