import {
  TELEMETRY_MAX_BATCH_SIZE,
  TelemetryEventName,
  TelemetryRollup,
  TelemetryService,
  zTelemetryEvent,
  zTelemetryEventBatch,
} from './telemetry.service';

/* ─────────────────────────────── zod 계약 ─────────────────────────────── */

describe('zTelemetryEvent', () => {
  it('name만 있으면 통과 — 나머지 전부 optional', () => {
    const parsed = zTelemetryEvent.parse({ name: 'playback_start' });
    expect(parsed).toEqual({ name: 'playback_start' });
  });

  it('낯선 이벤트 이름도 봉투 형태만 맞으면 통과(거부는 배치 처리 단계가 아니라 서비스가 판단)', () => {
    expect(() => zTelemetryEvent.parse({ name: 'no_such_event' })).not.toThrow();
  });

  it('name 누락 시 거부', () => {
    expect(() => zTelemetryEvent.parse({})).toThrow();
  });

  it('name 빈 문자열 거부', () => {
    expect(() => zTelemetryEvent.parse({ name: '' })).toThrow();
  });

  it('payload는 임의 키-값 레코드 허용', () => {
    const parsed = zTelemetryEvent.parse({
      name: 'playback_progress',
      payload: { percent: 50, extra: 'x' },
    });
    expect(parsed.payload).toEqual({ percent: 50, extra: 'x' });
  });

  it('occurredAt은 ISO datetime 문자열만 허용', () => {
    expect(() =>
      zTelemetryEvent.parse({ name: 'playback_start', occurredAt: 'not-a-date' }),
    ).toThrow();
    expect(() =>
      zTelemetryEvent.parse({ name: 'playback_start', occurredAt: '2026-08-09T00:00:00.000Z' }),
    ).not.toThrow();
  });
});

describe('zTelemetryEventBatch', () => {
  it('빈 배열 거부(최소 1건)', () => {
    expect(() => zTelemetryEventBatch.parse([])).toThrow();
  });

  it('상한 이하는 통과', () => {
    const batch = Array.from({ length: TELEMETRY_MAX_BATCH_SIZE }, () => ({
      name: 'playback_start',
    }));
    expect(() => zTelemetryEventBatch.parse(batch)).not.toThrow();
  });

  it('상한 초과는 거부', () => {
    const batch = Array.from({ length: TELEMETRY_MAX_BATCH_SIZE + 1 }, () => ({
      name: 'playback_start',
    }));
    expect(() => zTelemetryEventBatch.parse(batch)).toThrow();
  });
});

/* ─────────────────────────────── TelemetryRollup(순수) ─────────────────────────────── */

describe('TelemetryRollup', () => {
  it('알려진 이벤트는 known, 낯선 이벤트는 unknown 반환 + unknownEventCount 증가', () => {
    const rollup = new TelemetryRollup();
    expect(rollup.record({ name: TelemetryEventName.PlaybackStart })).toBe('known');
    expect(rollup.record({ name: 'not_a_real_event' })).toBe('unknown');

    const summary = rollup.toSummary();
    expect(summary.totalEventsReceived).toBe(2);
    expect(summary.unknownEventCount).toBe(1);
  });

  describe('① 콘텐츠 소비', () => {
    it('playback_start — 총 건수 + contentId별 조회 집계', () => {
      const rollup = new TelemetryRollup();
      rollup.record({ name: TelemetryEventName.PlaybackStart, contentId: 'c-1' });
      rollup.record({ name: TelemetryEventName.PlaybackStart, contentId: 'c-1' });
      rollup.record({ name: TelemetryEventName.PlaybackStart, contentId: 'c-2' });
      rollup.record({ name: TelemetryEventName.PlaybackStart }); // contentId 없어도 총계엔 반영

      const { consumption } = rollup.toSummary();
      expect(consumption.playbackStartCount).toBe(4);
      expect(consumption.viewCountsByContent).toEqual({ 'c-1': 2, 'c-2': 1 });
    });

    it('playback_progress — 25/50/75/100 마일스톤별 집계, 그 외 값은 무시', () => {
      const rollup = new TelemetryRollup();
      for (const percent of [25, 50, 50, 75, 100, 100, 100]) {
        rollup.record({ name: TelemetryEventName.PlaybackProgress, payload: { percent } });
      }
      rollup.record({ name: TelemetryEventName.PlaybackProgress, payload: { percent: 33 } }); // 미정의 마일스톤
      rollup.record({ name: TelemetryEventName.PlaybackProgress }); // payload 없음

      const { consumption } = rollup.toSummary();
      expect(consumption.progressMilestoneCounts).toEqual({ p25: 1, p50: 2, p75: 1, p100: 3 });
    });
  });

  describe('② 업로드 퍼널 — KPI: 업로드 위저드 완주율', () => {
    it('진입∩완료 세션 / 진입 세션', () => {
      const rollup = new TelemetryRollup();
      rollup.record({ name: TelemetryEventName.WizardStepEnter, sessionId: 's1' });
      rollup.record({ name: TelemetryEventName.WizardStepEnter, sessionId: 's2' });
      rollup.record({ name: TelemetryEventName.WizardStepEnter, sessionId: 's3' });
      rollup.record({ name: TelemetryEventName.UploadComplete, sessionId: 's1' });
      rollup.record({ name: TelemetryEventName.UploadComplete, sessionId: 's2' });
      // s3는 완료하지 않음, s4는 진입 없이 완료(상관 불가 — 분자에서 제외)
      rollup.record({ name: TelemetryEventName.UploadComplete, sessionId: 's4' });

      const { uploadFunnel } = rollup.toSummary();
      expect(uploadFunnel.wizardCompletionRate).toBeCloseTo(2 / 3);
    });

    it('진입 세션이 0건이면 null(관측 없음, 0이 아님)', () => {
      const rollup = new TelemetryRollup();
      expect(rollup.toSummary().uploadFunnel.wizardCompletionRate).toBeNull();
    });

    it('sessionId 없는 이벤트는 상관 불가 — 완주율 분모·분자에 기여하지 않는다', () => {
      const rollup = new TelemetryRollup();
      rollup.record({ name: TelemetryEventName.WizardStepEnter }); // sessionId 없음
      rollup.record({ name: TelemetryEventName.UploadComplete }); // sessionId 없음

      expect(rollup.toSummary().uploadFunnel.wizardCompletionRate).toBeNull();
    });
  });

  describe('② 업로드 퍼널 — KPI: 업로드 중단 후 재개 성공률', () => {
    it('재개∩완료 세션 / 재개 세션', () => {
      const rollup = new TelemetryRollup();
      rollup.record({ name: TelemetryEventName.UploadResume, sessionId: 's1' });
      rollup.record({ name: TelemetryEventName.UploadResume, sessionId: 's2' });
      rollup.record({ name: TelemetryEventName.UploadComplete, sessionId: 's1' });
      // s2는 재개 후 완료 못함

      const { uploadFunnel } = rollup.toSummary();
      expect(uploadFunnel.resumeSuccessRate).toBeCloseTo(0.5);
    });

    it('재개 세션이 0건이면 null', () => {
      const rollup = new TelemetryRollup();
      rollup.record({ name: TelemetryEventName.UploadComplete, sessionId: 's1' });
      expect(rollup.toSummary().uploadFunnel.resumeSuccessRate).toBeNull();
    });
  });

  it('업로드 퍼널 원시 카운터(진입·이탈·시작·재개·완료)가 전부 집계된다', () => {
    const rollup = new TelemetryRollup();
    rollup.record({ name: TelemetryEventName.WizardStepEnter });
    rollup.record({ name: TelemetryEventName.WizardStepExit });
    rollup.record({ name: TelemetryEventName.UploadStart });
    rollup.record({ name: TelemetryEventName.UploadResume });
    rollup.record({ name: TelemetryEventName.UploadComplete });

    const { uploadFunnel } = rollup.toSummary();
    expect(uploadFunnel.wizardStepEnterCount).toBe(1);
    expect(uploadFunnel.wizardStepExitCount).toBe(1);
    expect(uploadFunnel.uploadStartCount).toBe(1);
    expect(uploadFunnel.uploadResumeCount).toBe(1);
    expect(uploadFunnel.uploadCompleteCount).toBe(1);
  });

  describe('② 큰 자막 모드 — KPI: 큰 자막 모드 활성 비율', () => {
    it('세션별 최종 관측 상태(수신 순서 기준)가 ON인 비율', () => {
      const rollup = new TelemetryRollup();
      rollup.record({
        name: TelemetryEventName.LargeCaptionToggle,
        sessionId: 's1',
        payload: { enabled: true },
      });
      rollup.record({
        name: TelemetryEventName.LargeCaptionToggle,
        sessionId: 's1',
        payload: { enabled: false }, // s1의 최종 상태는 OFF(가장 나중 값이 이긴다)
      });
      rollup.record({
        name: TelemetryEventName.LargeCaptionToggle,
        sessionId: 's2',
        payload: { enabled: true },
      });

      const { largeCaptionMode } = rollup.toSummary();
      expect(largeCaptionMode.toggleOnEventCount).toBe(2);
      expect(largeCaptionMode.toggleOffEventCount).toBe(1);
      expect(largeCaptionMode.activeRatio).toBeCloseTo(1 / 2); // s1=OFF, s2=ON
    });

    it('sessionId 없는 토글은 각각 독립 세션으로 집계(유실 방지)', () => {
      const rollup = new TelemetryRollup();
      rollup.record({ name: TelemetryEventName.LargeCaptionToggle, payload: { enabled: true } });
      rollup.record({ name: TelemetryEventName.LargeCaptionToggle, payload: { enabled: false } });

      const { largeCaptionMode } = rollup.toSummary();
      expect(largeCaptionMode.activeRatio).toBeCloseTo(0.5); // 2개의 독립 "세션" 중 1개 ON
    });

    it('payload.enabled가 boolean이 아니면 무시(카운터·비율 모두 미반영)', () => {
      const rollup = new TelemetryRollup();
      rollup.record({
        name: TelemetryEventName.LargeCaptionToggle,
        sessionId: 's1',
        payload: { enabled: 'yes' },
      });

      const { largeCaptionMode } = rollup.toSummary();
      expect(largeCaptionMode.toggleOnEventCount).toBe(0);
      expect(largeCaptionMode.toggleOffEventCount).toBe(0);
      expect(largeCaptionMode.activeRatio).toBeNull();
    });

    it('관측된 세션이 0건이면 null', () => {
      const rollup = new TelemetryRollup();
      expect(rollup.toSummary().largeCaptionMode.activeRatio).toBeNull();
    });
  });

  describe('③ 모드 선택', () => {
    it('simple/precise 카운트 + 채택률', () => {
      const rollup = new TelemetryRollup();
      rollup.record({ name: TelemetryEventName.ModeSelected, payload: { mode: 'simple' } });
      rollup.record({ name: TelemetryEventName.ModeSelected, payload: { mode: 'simple' } });
      rollup.record({ name: TelemetryEventName.ModeSelected, payload: { mode: 'precise' } });

      const { modeSelection } = rollup.toSummary();
      expect(modeSelection.simpleCount).toBe(2);
      expect(modeSelection.preciseCount).toBe(1);
      expect(modeSelection.simpleAdoptionRate).toBeCloseTo(2 / 3);
    });

    it('알 수 없는 mode 값은 무시', () => {
      const rollup = new TelemetryRollup();
      rollup.record({ name: TelemetryEventName.ModeSelected, payload: { mode: 'turbo' } });

      const { modeSelection } = rollup.toSummary();
      expect(modeSelection.simpleCount).toBe(0);
      expect(modeSelection.preciseCount).toBe(0);
      expect(modeSelection.simpleAdoptionRate).toBeNull();
    });

    it('관측 0건이면 채택률 null', () => {
      const rollup = new TelemetryRollup();
      expect(rollup.toSummary().modeSelection.simpleAdoptionRate).toBeNull();
    });
  });
});

/* ─────────────────────────────── TelemetryService(래퍼) ─────────────────────────────── */

describe('TelemetryService', () => {
  it('ingest — known/unknown 건수를 응답으로 반환하고 롤업에 반영한다', () => {
    const service = new TelemetryService();

    const result = service.ingest([
      { name: TelemetryEventName.PlaybackStart, contentId: 'c-1' },
      { name: TelemetryEventName.ModeSelected, payload: { mode: 'simple' } },
      { name: 'unknown_event_x' },
    ]);

    expect(result).toEqual({ accepted: 2, unknownEventCount: 1 });

    const summary = service.summary();
    expect(summary.totalEventsReceived).toBe(3);
    expect(summary.unknownEventCount).toBe(1);
    expect(summary.consumption.playbackStartCount).toBe(1);
    expect(summary.modeSelection.simpleCount).toBe(1);
  });

  it('summary는 여러 ingest 호출에 걸쳐 누적된다(인메모리 롤업 — 프로세스 생애주기 동안 유지)', () => {
    const service = new TelemetryService();
    service.ingest([{ name: TelemetryEventName.UploadStart }]);
    service.ingest([{ name: TelemetryEventName.UploadStart }]);

    expect(service.summary().uploadFunnel.uploadStartCount).toBe(2);
  });

  it('빈 배열 ingest는 0/0을 반환한다(빈 배치 자체는 zod가 걸러내지만 서비스 계층은 방어적으로 허용)', () => {
    const service = new TelemetryService();
    expect(service.ingest([])).toEqual({ accepted: 0, unknownEventCount: 0 });
  });
});
