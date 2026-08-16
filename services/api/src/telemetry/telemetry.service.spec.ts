// ★ 이름 카탈로그·봉투 상한은 shared가 단일 원천(T-W2-29, 대장 #128) — 이 스펙이 api 로컬 사본을
//   참조하면 클라이언트와의 drift를 잡을 수 없다. 서버 내부 값(롤업 용량·zod 스키마)만 로컬에서 온다.
import {
  TELEMETRY_EVENT_NAMES,
  TELEMETRY_MAX_BATCH_SIZE,
  TELEMETRY_MAX_PAYLOAD_BYTES,
  TelemetryEventName,
} from '@gachinol/shared';
import {
  TELEMETRY_MAX_ROLLUP_KEYS,
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

  describe(`payload 직렬화 크기 상한(${TELEMETRY_MAX_PAYLOAD_BYTES}바이트, AC: 과대 payload → 400)`, () => {
    it('상한 이하는 통과', () => {
      const payload = { note: 'x'.repeat(TELEMETRY_MAX_PAYLOAD_BYTES - 50) };
      expect(() => zTelemetryEvent.parse({ name: 'playback_start', payload })).not.toThrow();
    });

    it('상한 초과는 거부(단일 거대 값)', () => {
      const payload = { note: 'x'.repeat(TELEMETRY_MAX_PAYLOAD_BYTES + 1) };
      expect(() => zTelemetryEvent.parse({ name: 'playback_start', payload })).toThrow();
    });

    it('상한 초과는 거부(다수의 작은 키 합산)', () => {
      const payload: Record<string, string> = {};
      for (let i = 0; i < TELEMETRY_MAX_PAYLOAD_BYTES; i += 1) payload[`k${i}`] = '1';
      expect(() => zTelemetryEvent.parse({ name: 'playback_start', payload })).toThrow();
    });

    it('멀티바이트(한글) payload는 문자 길이가 아니라 UTF-8 바이트 길이로 판정한다', () => {
      // 한글 1자 = UTF-8 3바이트. 문자수 기준이면 상한 이하로 보이지만 바이트 기준으로는 초과.
      const charCount = Math.floor(TELEMETRY_MAX_PAYLOAD_BYTES / 2);
      const payload = { note: '가'.repeat(charCount) };
      expect(() => zTelemetryEvent.parse({ name: 'playback_start', payload })).toThrow();
    });
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

  /**
   * ★ 계약 구동 확인(T-W2-29) — shared 카탈로그에 이름을 추가하고 서버 배선(switch case)을 잊으면
   * 여기가 깨진다. 이름 목록을 이 파일에 재타이핑하지 않고 `TELEMETRY_EVENT_NAMES`로 전수 순회하므로
   * 사본이 생기지 않는다(카탈로그가 늘면 케이스도 자동으로 늘어난다).
   */
  it.each(TELEMETRY_EVENT_NAMES)('shared 카탈로그의 %s는 서버가 known으로 처리한다', (name) => {
    const rollup = new TelemetryRollup();
    expect(rollup.record({ name })).toBe('known');
    expect(rollup.toSummary().unknownEventCount).toBe(0);
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

    it('대장 #79 조치① — sessionId 없는 토글은 세션 Map에 넣지 않고 별도 스칼라로만 집계(activeRatio에서 제외)', () => {
      const rollup = new TelemetryRollup();
      rollup.record({ name: TelemetryEventName.LargeCaptionToggle, payload: { enabled: true } });
      rollup.record({ name: TelemetryEventName.LargeCaptionToggle, payload: { enabled: false } });
      // 세션 있는 이벤트 1건도 섞어서, 익명 이벤트가 activeRatio 분모에 전혀 기여하지 않음을 확인
      rollup.record({
        name: TelemetryEventName.LargeCaptionToggle,
        sessionId: 's1',
        payload: { enabled: true },
      });

      const { largeCaptionMode } = rollup.toSummary();
      expect(largeCaptionMode.toggleOnEventCount).toBe(2); // 익명 ON 1 + 세션 ON 1(원시 총계는 그대로 포함)
      expect(largeCaptionMode.toggleOffEventCount).toBe(1);
      expect(largeCaptionMode.activeRatio).toBe(1); // 세션 기반 분모=1건(s1=ON)뿐 — 익명 2건은 제외
      expect(largeCaptionMode.anonymousToggleObservedCount).toBe(2); // 익명 관측은 별도로 노출
    });

    it('AC① — 익명(sessionId 없는) 토글 1만 건을 넣어도 세션 Map은 전혀 자라지 않는다(드롭도 0건 — 애초에 시도조차 안 함)', () => {
      const rollup = new TelemetryRollup();
      for (let i = 0; i < 10_000; i += 1) {
        rollup.record({ name: TelemetryEventName.LargeCaptionToggle, payload: { enabled: i % 2 === 0 } });
      }

      const summary = rollup.toSummary();
      expect(summary.largeCaptionMode.anonymousToggleObservedCount).toBe(10_000);
      expect(summary.largeCaptionMode.toggleOnEventCount + summary.largeCaptionMode.toggleOffEventCount).toBe(
        10_000,
      );
      // 세션 Map이 비어있다는 증거: activeRatio는 "관측된 세션 0건"이라 null, 상한 드롭도 0건
      // (드롭이 0이라는 것은 애초에 이 Map에 삽입을 시도조차 하지 않았다는 뜻 — 시도했다면 5000건째부터
      // 드롭 카운터가 올라갔을 것이다)
      expect(summary.largeCaptionMode.activeRatio).toBeNull();
      expect(summary.capacityDrops.captionSessionStates).toBe(0);
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

  describe('대장 #79 조치③ — 롤업 컬렉션 상한 + 드롭 카운터(AC: 상한 초과 시 드롭 카운터가 오른다)', () => {
    it('TelemetryRollup() 기본 생성자는 운영 상수(TELEMETRY_MAX_ROLLUP_KEYS)를 사용한다', () => {
      const rollup = new TelemetryRollup();
      for (let i = 0; i < TELEMETRY_MAX_ROLLUP_KEYS + 3; i += 1) {
        rollup.record({ name: TelemetryEventName.PlaybackStart, contentId: `c-${i}` });
      }
      const summary = rollup.toSummary();
      expect(Object.keys(summary.consumption.viewCountsByContent)).toHaveLength(TELEMETRY_MAX_ROLLUP_KEYS);
      expect(summary.capacityDrops.viewCountsByContent).toBe(3);
    });

    it('viewCountsByContent(contentId Map) — 상한 초과 시 신규 contentId만 드롭, 기존 키 갱신·원시 총계는 항상 정확', () => {
      const rollup = new TelemetryRollup(2); // 테스트 속도를 위해 작은 상한 주입
      rollup.record({ name: TelemetryEventName.PlaybackStart, contentId: 'c-1' });
      rollup.record({ name: TelemetryEventName.PlaybackStart, contentId: 'c-2' });
      rollup.record({ name: TelemetryEventName.PlaybackStart, contentId: 'c-3' }); // 상한 초과 → 드롭
      rollup.record({ name: TelemetryEventName.PlaybackStart, contentId: 'c-1' }); // 기존 키 갱신은 항상 허용

      const summary = rollup.toSummary();
      expect(summary.consumption.viewCountsByContent).toEqual({ 'c-1': 2, 'c-2': 1 });
      expect(summary.capacityDrops.viewCountsByContent).toBe(1);
      expect(summary.consumption.playbackStartCount).toBe(4); // 드롭돼도 원시 총계는 항상 전부 집계
    });

    it('sessionsEnteredWizard(세션 Set) — 상한 초과 시 신규 sessionId만 드롭', () => {
      const rollup = new TelemetryRollup(2);
      rollup.record({ name: TelemetryEventName.WizardStepEnter, sessionId: 's1' });
      rollup.record({ name: TelemetryEventName.WizardStepEnter, sessionId: 's2' });
      rollup.record({ name: TelemetryEventName.WizardStepEnter, sessionId: 's3' }); // 드롭
      rollup.record({ name: TelemetryEventName.WizardStepEnter, sessionId: 's1' }); // 기존 키 재관측은 무해(Set 크기 불변)

      const summary = rollup.toSummary();
      expect(summary.capacityDrops.sessionsEnteredWizard).toBe(1);
      expect(summary.uploadFunnel.wizardStepEnterCount).toBe(4); // 원시 총계는 항상 정확
    });

    it('sessionsResumedUpload(세션 Set) — 상한 초과 시 신규 sessionId만 드롭', () => {
      const rollup = new TelemetryRollup(1);
      rollup.record({ name: TelemetryEventName.UploadResume, sessionId: 's1' });
      rollup.record({ name: TelemetryEventName.UploadResume, sessionId: 's2' }); // 드롭

      expect(rollup.toSummary().capacityDrops.sessionsResumedUpload).toBe(1);
    });

    it('sessionsCompletedUpload(세션 Set) — 상한 초과 시 신규 sessionId만 드롭', () => {
      const rollup = new TelemetryRollup(1);
      rollup.record({ name: TelemetryEventName.UploadComplete, sessionId: 's1' });
      rollup.record({ name: TelemetryEventName.UploadComplete, sessionId: 's2' }); // 드롭

      expect(rollup.toSummary().capacityDrops.sessionsCompletedUpload).toBe(1);
    });

    it('latestCaptionStateBySession(세션별 최신 상태 Map) — 상한 초과 시 신규 세션만 드롭, 기존 세션 상태 갱신은 항상 허용', () => {
      const rollup = new TelemetryRollup(1);
      rollup.record({
        name: TelemetryEventName.LargeCaptionToggle,
        sessionId: 's1',
        payload: { enabled: true },
      });
      rollup.record({
        name: TelemetryEventName.LargeCaptionToggle,
        sessionId: 's2', // 상한(1) 초과 → 드롭
        payload: { enabled: true },
      });
      rollup.record({
        name: TelemetryEventName.LargeCaptionToggle,
        sessionId: 's1', // 기존 세션 상태 갱신은 상한과 무관하게 항상 허용
        payload: { enabled: false },
      });

      const summary = rollup.toSummary();
      expect(summary.capacityDrops.captionSessionStates).toBe(1);
      expect(summary.largeCaptionMode.activeRatio).toBe(0); // s1만 추적됨, 최종 상태 OFF
      expect(summary.largeCaptionMode.toggleOnEventCount).toBe(2); // 드롭돼도 원시 총계는 항상 정확
    });

    it('상한에 부딪히지 않으면 모든 capacityDrops 필드가 0(관측 완전)', () => {
      const rollup = new TelemetryRollup();
      rollup.record({ name: TelemetryEventName.PlaybackStart, contentId: 'c-1' });
      rollup.record({ name: TelemetryEventName.WizardStepEnter, sessionId: 's1' });

      expect(rollup.toSummary().capacityDrops).toEqual({
        viewCountsByContent: 0,
        sessionsEnteredWizard: 0,
        sessionsResumedUpload: 0,
        sessionsCompletedUpload: 0,
        captionSessionStates: 0,
      });
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
