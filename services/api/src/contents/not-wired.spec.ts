import {
  allContentTransitionEdges,
  AUTO_PROGRESS_CONTENT_STATUSES,
  canTransitionContent,
  contentTransitionKey,
  CONTENT_STATUS_TRANSITIONS,
  hasImplementedContentExit,
  implementedNextStates,
  isAutoProgressContentStatus,
  isContentTransitionImplemented,
  isContentTransitionWired,
  isStalledAutomationContentStatus,
  NOT_WIRED,
  NOT_WIRED_CONTENT_TRANSITIONS,
  NotWiredKind,
  reconcileContentWiring,
  STALLED_AUTOMATION_CONTENT_STATUSES,
  SYSTEM_DRIVEN_CONTENT_STATUSES,
} from '@gachinol/shared';
import { isTransitionProbeEnabled } from './transition-probe';

/**
 * 미구동 계약 레지스트리 단위 검증 (EXEC-DECISIONS #29 1계층).
 *
 * 여기서 하는 것: 레지스트리 **자체의 불변식**과 **파생 규칙**. 계측 대조(미관측 집합 == NOT_WIRED)는
 * 스위트 전체가 끝나야 판정할 수 있어 globalTeardown(test/wiring/global-teardown.ts)이 맡는다.
 * shared에는 테스트 러너가 없어(런타임 의존성 0 패키지) 레지스트리 스펙은 api 단위 스위트에 둔다.
 */
describe('NOT_WIRED 레지스트리 — 불변식', () => {
  test('모든 등재 항목이 CONTENT_STATUS_TRANSITIONS의 합법 엣지다', () => {
    const illegal = NOT_WIRED_CONTENT_TRANSITIONS.filter((e) => !canTransitionContent(e.from, e.to));
    expect(illegal).toEqual([]);
  });

  test('중복 등재 없음', () => {
    const keys = NOT_WIRED_CONTENT_TRANSITIONS.map((e) => contentTransitionKey(e.from, e.to));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('항목마다 kind와 사유가 붙어 있다 (#29 ③ 의무)', () => {
    for (const e of NOT_WIRED_CONTENT_TRANSITIONS) {
      expect(Object.values(NotWiredKind)).toContain(e.kind);
      expect(e.reason.trim().length).toBeGreaterThan(10);
    }
  });

  test('NOT_WIRED.contentTransitions는 엔트리와 같은 엣지 집합이다', () => {
    expect(NOT_WIRED.contentTransitions.map(([f, t]) => contentTransitionKey(f, t))).toEqual(
      NOT_WIRED_CONTENT_TRANSITIONS.map((e) => contentTransitionKey(e.from, e.to)),
    );
  });

  test('전이맵 엣지 전수 = 등재 + 미등재 (누락·중복 없이 분할)', () => {
    const all = allContentTransitionEdges();
    const total = Object.values(CONTENT_STATUS_TRANSITIONS).reduce((n, tos) => n + tos.length, 0);
    expect(all).toHaveLength(total);
    const notWired = all.filter(([f, t]) => !isContentTransitionWired(f, t));
    expect(notWired).toHaveLength(NOT_WIRED_CONTENT_TRANSITIONS.length);
  });
});

describe('구동/구현 술어', () => {
  test('등재 엣지는 wired가 아니다', () => {
    for (const e of NOT_WIRED_CONTENT_TRANSITIONS) {
      expect(isContentTransitionWired(e.from, e.to)).toBe(false);
    }
  });

  test('untested는 "구현됨"으로 센다 — UI 판정을 바꾸지 않는다', () => {
    const untested = NOT_WIRED_CONTENT_TRANSITIONS.filter((e) => e.kind === NotWiredKind.Untested);
    expect(untested.length).toBeGreaterThan(0);
    for (const e of untested) {
      expect(isContentTransitionWired(e.from, e.to)).toBe(false);
      expect(isContentTransitionImplemented(e.from, e.to)).toBe(true);
    }
  });

  test('unimplemented만 "구현 안 됨"이다', () => {
    const unimplemented = NOT_WIRED_CONTENT_TRANSITIONS.filter(
      (e) => e.kind === NotWiredKind.Unimplemented,
    );
    expect(unimplemented.length).toBeGreaterThan(0);
    for (const e of unimplemented) {
      expect(isContentTransitionImplemented(e.from, e.to)).toBe(false);
      expect(implementedNextStates(e.from)).not.toContain(e.to);
    }
  });

  test('전이맵에 없는 엣지는 wired도 implemented도 아니다', () => {
    expect(isContentTransitionWired('draft', 'published')).toBe(false);
    expect(isContentTransitionImplemented('draft', 'published')).toBe(false);
  });
});

describe('UI 파생 — 자동 진행 / 정지 (#29 ④)', () => {
  test('자동 진행 ∪ 정지 = 시스템 구동 후보, 교집합 없음', () => {
    expect([...AUTO_PROGRESS_CONTENT_STATUSES, ...STALLED_AUTOMATION_CONTENT_STATUSES].sort()).toEqual(
      [...SYSTEM_DRIVEN_CONTENT_STATUSES].sort(),
    );
    expect(
      AUTO_PROGRESS_CONTENT_STATUSES.filter((s) => isStalledAutomationContentStatus(s)),
    ).toEqual([]);
  });

  test('정지 판정 = 후보인데 구현된 출구 0건 (하드코딩 아님)', () => {
    for (const s of SYSTEM_DRIVEN_CONTENT_STATUSES) {
      expect(isStalledAutomationContentStatus(s)).toBe(!hasImplementedContentExit(s));
      expect(isAutoProgressContentStatus(s)).toBe(hasImplementedContentExit(s));
    }
  });

  /**
   * 현재 등재 상태의 결과 고정 — auto_edit(대장 #98)이 구현돼 regenerating 3엣지가 레지스트리에서
   * 빠지면 이 테스트가 레드가 되어 "UI가 이미 자동으로 따라왔다"를 알린다(박제 방지).
   */
  test('현재는 regenerating 1종만 정지 — auto_edit 구현 시 이 단정이 깨진다', () => {
    expect(STALLED_AUTOMATION_CONTENT_STATUSES).toEqual(['regenerating']);
    expect(isAutoProgressContentStatus('regenerating')).toBe(false);
    expect(hasImplementedContentExit('regenerating')).toBe(false);
  });

  test('regenerating 외 후보 7종은 자동 진행이다 (회귀 방지)', () => {
    for (const s of [
      'uploading',
      'uploaded',
      'processing',
      'analyzing',
      'preview_generating',
      'publishing',
      'reporter_approved',
    ] as const) {
      expect(isAutoProgressContentStatus(s)).toBe(true);
    }
  });

  test('사람이 다음 홉을 지시하는 상태는 후보가 아니다 (자동 진행으로 오분류 금지)', () => {
    for (const s of ['draft', 'center_approved', 'awaiting_center_review', 'published'] as const) {
      expect(isAutoProgressContentStatus(s)).toBe(false);
      expect(isStalledAutomationContentStatus(s)).toBe(false);
    }
  });
});

describe('reconcileContentWiring — 양방향 판정 규칙', () => {
  const allKeys = allContentTransitionEdges().map(([f, t]) => contentTransitionKey(f, t));
  const notWiredKeys = NOT_WIRED_CONTENT_TRANSITIONS.map((e) =>
    contentTransitionKey(e.from, e.to),
  );
  const wiredKeys = allKeys.filter((k) => !notWiredKeys.includes(k));

  test('구동 엣지 전부 관측 = 그린', () => {
    const r = reconcileContentWiring(wiredKeys);
    expect(r.ok).toBe(true);
    expect([...r.unobserved].sort()).toEqual([...notWiredKeys].sort());
  });

  test('구동 엣지 하나가 미관측이면 레드 (missingFromRegistry)', () => {
    const r = reconcileContentWiring(wiredKeys.slice(1));
    expect(r.ok).toBe(false);
    expect(r.missingFromRegistry).toEqual([wiredKeys[0]]);
  });

  test('등재 엣지가 관측되면 레드 (staleInRegistry — 역방향 강제)', () => {
    const r = reconcileContentWiring([...wiredKeys, notWiredKeys[0] as string]);
    expect(r.ok).toBe(false);
    expect(r.staleInRegistry).toEqual([notWiredKeys[0]]);
  });

  test('전이맵에 없는 엣지가 관측되면 레드 (illegalObserved)', () => {
    const r = reconcileContentWiring([...wiredKeys, contentTransitionKey('draft', 'published')]);
    expect(r.ok).toBe(false);
    expect(r.illegalObserved).toEqual(['draft→published']);
  });
});

describe('계측 훅 — 프로덕션 영향 0', () => {
  test('테스트 실행 중에는 켜져 있다 (globalSetup이 디렉터리를 연다)', () => {
    expect(isTransitionProbeEnabled()).toBe(true);
  });

  /**
   * 활성 조건은 모듈 로드 시 1회 평가된다 — `NODE_ENV==='test'` AND `GACHINOL_WIRING_PROBE_DIR`.
   * 후자는 api 단위 jest globalSetup만 심는다(env.schema.ts·.env·컨테이너 어디에도 없다).
   */
  test('활성 env 키는 어떤 프로덕션 설정에도 존재하지 않는다', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.GACHINOL_WIRING_PROBE_DIR).toBeTruthy();
  });
});
