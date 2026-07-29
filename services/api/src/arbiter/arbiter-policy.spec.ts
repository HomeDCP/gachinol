import {
  DEFAULT_HOLD_POLICY,
  decideHold,
  describeHold,
  parseArbiterState,
  type DcpArbiterState,
} from './arbiter-policy';

const state = (over: Partial<DcpArbiterState> = {}): DcpArbiterState => ({
  busy: false,
  stage: null,
  queued: 0,
  since: null,
  ...over,
});

describe('decideHold', () => {
  it('DCP 유휴(busy=false, 대기 0) → 진행', () => {
    expect(decideHold(state())).toEqual({ hold: false, reason: null });
  });

  it('busy=true → 정지(권위 술어)', () => {
    const d = decideHold(state({ busy: true, stage: 'encoding' }));
    expect(d).toEqual({ hold: true, reason: 'dcp_busy' });
  });

  it('busy 판정은 stage와 무관 — stage가 null이어도 busy면 정지', () => {
    // 계약이 stage를 안 채우는 경우가 생겨도 busy만으로 정지해야 한다
    expect(decideHold(state({ busy: true, stage: null })).hold).toBe(true);
  });

  describe('imminent — 활성 잡 없음 + 대기 있음', () => {
    it('stage=null & queued>0 → 정지(디스패처가 곧 집어감)', () => {
      const d = decideHold(state({ stage: null, queued: 2 }));
      expect(d).toEqual({ hold: true, reason: 'dcp_imminent' });
    });

    it('holdOnImminent=false면 진행(킬스위치)', () => {
      const d = decideHold(state({ stage: null, queued: 2 }), {
        ...DEFAULT_HOLD_POLICY,
        holdOnImminent: false,
      });
      expect(d.hold).toBe(false);
    });
  });

  // 이 스위트가 이 모듈의 존재 이유 — /api/queue의 active만 봤다면 여기서 영구 정지했다
  describe('개입/검수 대기(활성이지만 CPU 미사용)', () => {
    it.each(['review_pending', 'qc_pending', 'needs_intervention', 'paused'])(
      'stage=%s & queued>0 → 진행(사람 대기라 큐가 안 움직임 → 양보하면 우리가 영구 정지)',
      (stage) => {
        const d = decideHold(state({ busy: false, stage, queued: 3 }));
        expect(d).toEqual({ hold: false, reason: null });
      },
    );

    it('개입 대기 + 대기 0 → 진행', () => {
      expect(decideHold(state({ stage: 'review_pending', queued: 0 })).hold).toBe(false);
    });
  });

  describe('조회 실패(state=null)', () => {
    it('기본 failMode=hold → 정지', () => {
      expect(decideHold(null)).toEqual({ hold: true, reason: 'dcp_unreachable' });
    });

    it('failMode=run → 진행(가용성 우선)', () => {
      const d = decideHold(null, { ...DEFAULT_HOLD_POLICY, failMode: 'run' });
      expect(d).toEqual({ hold: false, reason: null });
    });
  });
});

describe('parseArbiterState', () => {
  it('계약 응답을 파싱한다', () => {
    expect(
      parseArbiterState({ busy: true, stage: 'encoding', queued: 2, since: '2026-07-30T00:00:00Z' }),
    ).toEqual({ busy: true, stage: 'encoding', queued: 2, since: '2026-07-30T00:00:00Z' });
  });

  it('모르는 필드는 무시한다(계약은 필드 추가만 보장)', () => {
    const parsed = parseArbiterState({ busy: false, stage: null, queued: 0, since: null, imminent: true });
    expect(parsed).toEqual({ busy: false, stage: null, queued: 0, since: null });
  });

  it('queued 누락은 0으로 저하한다(busy 판정은 여전히 가능)', () => {
    expect(parseArbiterState({ busy: true, stage: 'encoding', since: null })?.queued).toBe(0);
  });

  it.each([
    ['busy 누락', { stage: null, queued: 0 }],
    ['busy 타입 불일치', { busy: 'true', stage: null }],
    ['stage 타입 불일치', { busy: false, stage: 3 }],
    ['HTML 파싱물 등 비객체', 'not json'],
    ['null', null],
  ])('계약 위반(%s) → null(조회 실패로 취급)', (_label, body) => {
    expect(parseArbiterState(body)).toBeNull();
  });
});

describe('describeHold', () => {
  it('사유별 한국어 안내를 만든다', () => {
    expect(describeHold('dcp_busy', state({ busy: true, stage: 'encoding' }))).toContain('encoding');
    expect(describeHold('dcp_imminent', state({ queued: 2 }))).toContain('2건');
    expect(describeHold('dcp_unreachable', null)).toContain('확인할 수 없어');
    expect(describeHold(null, state())).toBe('처리 가능');
  });
});
