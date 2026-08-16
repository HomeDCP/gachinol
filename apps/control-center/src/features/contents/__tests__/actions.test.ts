import {
  CONTENT_STATUS_TRANSITIONS,
  ContentStatus,
  ReviewPolicy,
  afterReporterApproval,
  isAutoProgressContentStatus,
  isFailureStatus,
  isMinorConsentPending,
} from '@gachinol/shared';
import {
  centerActionsFor,
  minorConsentActionsFor,
  minorConsentGateEdge,
  minorConsentGateState,
} from '../actions';

describe('centerActionsFor', () => {
  test('awaiting_center_review → canDecide=true, canRetry=false', () => {
    expect(centerActionsFor({ status: 'awaiting_center_review' })).toEqual({
      canDecide: true,
      canRetry: false,
      canDistribute: false,
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

  test('revision_requested·published 외 21종은 전부 빈 배열 — 다른 정지 상태는 canRetry/canDecide가 이미 진행 경로를 제공', () => {
    const open: string[] = [];
    for (const status of Object.values(ContentStatus)) {
      const targets = centerActionsFor({ status }).manualTransitionTargets;
      if (targets.length > 0) open.push(status);
    }
    expect(open.sort()).toEqual([ContentStatus.Published, ContentStatus.RevisionRequested].sort());
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

  test('manualTransitionTargets가 있으면 canDecide·canRetry·canDistribute는 전부 false (탈출구 중복 없음)', () => {
    for (const status of [ContentStatus.RevisionRequested, ContentStatus.Published] as const) {
      const a = centerActionsFor({ status });
      expect(a.manualTransitionTargets.length).toBeGreaterThan(0);
      expect(a.canDecide).toBe(false);
      expect(a.canRetry).toBe(false);
      expect(a.canDistribute).toBe(false);
    }
  });
});

/**
 * 미성년자 동의 게이트 액션 (T-W2-32, 대장 #130) — 서버 `confirmMinorConsent`/`withdrawMinorConsent`
 * (services/api/src/contents/contents.service.ts)의 수용 조건을 UI가 **미리** 판정하는지 고정한다.
 * 특히 철회 거부 조건(게이트 전이가 로그에 이미 있음)을 반영하지 않으면 "눌러도 409로 거절되는 버튼"이 된다.
 */
describe('minorConsentGateEdge — 게이트가 지키는 엣지는 reviewPolicy로 갈린다', () => {
  test('reporter_only → 기자 종단 승인 hop (센터 검토를 아예 안 거치므로 그 hop이 실질 승인)', () => {
    expect(minorConsentGateEdge(ReviewPolicy.ReporterOnly)).toEqual({
      from: ContentStatus.AwaitingReporterReview,
      to: ContentStatus.ReporterApproved,
    });
  });

  test('reporter_then_center → 센터 승인 hop', () => {
    expect(minorConsentGateEdge(ReviewPolicy.ReporterThenCenter)).toEqual({
      from: ContentStatus.AwaitingCenterReview,
      to: ContentStatus.CenterApproved,
    });
  });

  test('분기는 shared afterReporterApproval에서 파생된다 (전 정책 순회)', () => {
    for (const policy of Object.values(ReviewPolicy)) {
      const edge = minorConsentGateEdge(policy);
      const expectReporterHop = afterReporterApproval(policy) === ContentStatus.Publishing;
      expect(edge.from).toBe(
        expectReporterHop ? ContentStatus.AwaitingReporterReview : ContentStatus.AwaitingCenterReview,
      );
    }
  });
});

describe('minorConsentGateState — 판정 원천은 전이 이력 실측(approvedAt 아님)', () => {
  const noHistory = { logs: [], complete: true };

  test('게이트 엣지가 이력에 있으면 passed', () => {
    expect(
      minorConsentGateState(
        { reviewPolicy: ReviewPolicy.ReporterThenCenter },
        {
          logs: [{ fromStatus: 'awaiting_center_review', toStatus: 'center_approved' }],
          complete: true,
        },
      ),
    ).toBe('passed');
  });

  test('다른 정책의 엣지는 통과로 세지 않는다 — reporter_then_center에 기자 승인 hop만 있는 경우', () => {
    expect(
      minorConsentGateState(
        { reviewPolicy: ReviewPolicy.ReporterThenCenter },
        {
          logs: [{ fromStatus: 'awaiting_reporter_review', toStatus: 'reporter_approved' }],
          complete: true,
        },
      ),
    ).toBe('not_passed');
  });

  test('reporter_only는 기자 승인 hop이 곧 통과다', () => {
    expect(
      minorConsentGateState(
        { reviewPolicy: ReviewPolicy.ReporterOnly },
        {
          logs: [{ fromStatus: 'awaiting_reporter_review', toStatus: 'reporter_approved' }],
          complete: true,
        },
      ),
    ).toBe('passed');
  });

  test('이력을 끝까지 못 읽었으면 unknown — "미통과"로 단정하지 않는다(fail-closed)', () => {
    expect(
      minorConsentGateState({ reviewPolicy: ReviewPolicy.ReporterThenCenter }, { logs: [], complete: false }),
    ).toBe('unknown');
  });

  test('이력이 완결이고 게이트 엣지가 없으면 not_passed', () => {
    expect(minorConsentGateState({ reviewPolicy: ReviewPolicy.ReporterThenCenter }, noHistory)).toBe(
      'not_passed',
    );
  });
});

describe('minorConsentActionsFor', () => {
  const complete = (logs: readonly { fromStatus: string; toStatus: string }[] = []) => ({
    logs,
    complete: true,
  });
  const base = {
    reviewPolicy: ReviewPolicy.ReporterThenCenter,
    hasMinorSubject: true,
    minorConsentConfirmedAt: null as string | null,
  };

  test('hasMinorSubject=false → applicable·canConfirm·canWithdraw 전부 false (카드 미노출)', () => {
    const a = minorConsentActionsFor({ ...base, hasMinorSubject: false }, complete());
    expect(a.applicable).toBe(false);
    expect(a.canConfirm).toBe(false);
    expect(a.canWithdraw).toBe(false);
  });

  test('미확인 → canConfirm=true, canWithdraw=false (철회할 대상이 없다 = 서버 409)', () => {
    const a = minorConsentActionsFor(base, complete());
    expect(a.canConfirm).toBe(true);
    expect(a.canWithdraw).toBe(false);
    expect(a.withdrawBlockedBy).toBeUndefined();
  });

  test('확인됨 ∧ 게이트 미통과 → canWithdraw=true, canConfirm=false', () => {
    const a = minorConsentActionsFor(
      { ...base, minorConsentConfirmedAt: '2026-08-10T00:00:00.000Z' },
      complete(),
    );
    expect(a.canConfirm).toBe(false);
    expect(a.canWithdraw).toBe(true);
  });

  /** ★ 철회 불가 조건 — 이걸 반영하지 않으면 "눌러도 409로 거절되는 버튼"이 된다 */
  test('확인됨 ∧ 게이트 통과 → canWithdraw=false + blocked=gate_passed', () => {
    const a = minorConsentActionsFor(
      { ...base, minorConsentConfirmedAt: '2026-08-10T00:00:00.000Z' },
      complete([{ fromStatus: 'awaiting_center_review', toStatus: 'center_approved' }]),
    );
    expect(a.canWithdraw).toBe(false);
    expect(a.withdrawBlockedBy).toBe('gate_passed');
  });

  test('reporter_only는 기자 종단 승인 로그만으로도 철회가 막힌다 (정책별 엣지 차이)', () => {
    const logs = [{ fromStatus: 'awaiting_reporter_review', toStatus: 'reporter_approved' }];
    const reporterOnly = minorConsentActionsFor(
      {
        ...base,
        reviewPolicy: ReviewPolicy.ReporterOnly,
        minorConsentConfirmedAt: '2026-08-10T00:00:00.000Z',
      },
      complete(logs),
    );
    expect(reporterOnly.canWithdraw).toBe(false);
    expect(reporterOnly.withdrawBlockedBy).toBe('gate_passed');

    // 같은 로그라도 reporter_then_center에서는 게이트 통과가 아니다(이후 센터 게이트가 남아 있다)
    const thenCenter = minorConsentActionsFor(
      { ...base, minorConsentConfirmedAt: '2026-08-10T00:00:00.000Z' },
      complete(logs),
    );
    expect(thenCenter.canWithdraw).toBe(true);
  });

  test('확인됨 ∧ 이력 미완결 → canWithdraw=false + blocked=history_incomplete', () => {
    const a = minorConsentActionsFor(
      { ...base, minorConsentConfirmedAt: '2026-08-10T00:00:00.000Z' },
      { logs: [], complete: false },
    );
    expect(a.canWithdraw).toBe(false);
    expect(a.withdrawBlockedBy).toBe('history_incomplete');
  });

  test('판정은 shared isMinorConsentPending과 동치 — 사본 조건 금지', () => {
    for (const hasMinorSubject of [true, false]) {
      for (const at of [null, '2026-08-10T00:00:00.000Z']) {
        const facts = { ...base, hasMinorSubject, minorConsentConfirmedAt: at };
        expect(minorConsentActionsFor(facts, complete()).canConfirm).toBe(
          isMinorConsentPending(facts),
        );
      }
    }
  });
});
