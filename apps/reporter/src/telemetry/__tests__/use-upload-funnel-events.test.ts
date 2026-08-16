// use-upload-funnel-events.ts는 useApiClient()를 위해 모듈 스코프에서 auth-context.tsx를
// import하고, auth-context.tsx는 다시 expo-router를 import한다. 실 expo-router는
// @react-navigation/native를 트랜지티브로 끌어오는데 그 패키지의 pnpm 플래튼 경로가
// jest.config.js의 transformIgnorePatterns 화이트리스트와 어긋나 raw ESM 파싱 실패를 낸다
// (auth-context.test.ts와 동일 사유·동일 해법 — reporter 전역 jest 설정은 이 태스크 소유 파일이
// 아니라 건드리지 않는다).
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

import { TELEMETRY_MAX_BATCH_SIZE, TelemetryEventName } from '@gachinol/shared';
import type { ApiClient } from '../../api/client';
import { UploadMode } from '../../features/contents/mode';
import { TELEMETRY_FLUSH_INTERVAL_MS } from '../telemetry-batch';
import {
  __resetUploadFunnelTelemetryForTest,
  createUploadFunnelEvents,
} from '../use-upload-funnel-events';

/** http-upload-service.test.ts와 동형 ApiClient 모의 — request만 검증 대상 */
function makeClient(): { client: ApiClient; request: jest.Mock } {
  const request = jest.fn().mockResolvedValue({ accepted: 1, unknownEventCount: 0 });
  const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
  return { client, request };
}

/** 배치 전송 1건의 바디(= 이벤트 배열)를 꺼낸다 */
const bodyOf = (request: jest.Mock, callIndex = 0): { name: string; sessionId?: string }[] =>
  (request.mock.calls[callIndex]![2] as { body: { name: string; sessionId?: string }[] }).body;

beforeEach(() => {
  jest.useFakeTimers();
  __resetUploadFunnelTelemetryForTest();
});

afterEach(() => {
  __resetUploadFunnelTelemetryForTest();
  jest.useRealTimers();
});

describe('createUploadFunnelEvents — 발신 배선 (AC: 훅 호출이 실제 발생함을 모의 로거 호출 1회 이상으로 확인)', () => {
  it('wizardStepEnter — 플러시 후 POST /telemetry/events에 카탈로그 이름 + step payload', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.wizardStepEnter('classify', 'content-1');
    jest.advanceTimersByTime(TELEMETRY_FLUSH_INTERVAL_MS);

    expect(request).toHaveBeenCalledTimes(1);
    const [method, path, opts] = request.mock.calls[0]!;
    expect(method).toBe('POST');
    expect(path).toBe('/telemetry/events');
    expect((opts as { auth: boolean }).auth).toBe(false);
    const body = bodyOf(request);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      // ★ shared 카탈로그 참조 — 클라 리터럴을 자기참조로 단언하면 drift를 못 잡는다
      name: TelemetryEventName.WizardStepEnter,
      contentId: 'content-1',
      payload: { step: 'classify' },
    });
    expect(body[0]).toHaveProperty('occurredAt');
  });

  it('wizardStepExit — 카탈로그 이름 + step payload', () => {
    const { client, request } = makeClient();
    createUploadFunnelEvents(client).wizardStepExit('upload', 'content-1');
    jest.advanceTimersByTime(TELEMETRY_FLUSH_INTERVAL_MS);

    expect(bodyOf(request)[0]).toMatchObject({
      name: TelemetryEventName.WizardStepExit,
      payload: { step: 'upload' },
    });
  });

  it('uploadStart — 카탈로그 이름 + contentId', () => {
    const { client, request } = makeClient();
    createUploadFunnelEvents(client).uploadStart('content-1');
    jest.advanceTimersByTime(TELEMETRY_FLUSH_INTERVAL_MS);

    expect(bodyOf(request)[0]).toMatchObject({
      name: TelemetryEventName.UploadStart,
      contentId: 'content-1',
    });
  });

  it('uploadResume — 카탈로그 이름 + contentId (03§C-3 다시 시도 트리거)', () => {
    const { client, request } = makeClient();
    createUploadFunnelEvents(client).uploadResume('content-1');
    jest.advanceTimersByTime(TELEMETRY_FLUSH_INTERVAL_MS);

    expect(bodyOf(request)[0]).toMatchObject({
      name: TelemetryEventName.UploadResume,
      contentId: 'content-1',
    });
  });

  it('uploadComplete — 퍼널 종단이라 타이머를 기다리지 않고 즉시 전송된다(완주율 KPI 분자 보호)', () => {
    const { client, request } = makeClient();
    createUploadFunnelEvents(client).uploadComplete('content-1');

    expect(request).toHaveBeenCalledTimes(1); // 타이머 진행 없이
    expect(bodyOf(request)[0]).toMatchObject({
      name: TelemetryEventName.UploadComplete,
      contentId: 'content-1',
    });
  });

  it('발신 이름은 전부 shared 카탈로그 안에 있다 — 카탈로그 밖 이름은 서버가 조용히 버린다', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.wizardStepEnter('classify');
    events.wizardStepExit('classify');
    events.uploadStart('c1');
    events.uploadResume('c1');
    events.uploadComplete('c1'); // 강제 플러시

    const names = request.mock.calls.flatMap((_, i) => bodyOf(request, i).map((e) => e.name));
    expect(names).toEqual([
      TelemetryEventName.WizardStepEnter,
      TelemetryEventName.WizardStepExit,
      TelemetryEventName.UploadStart,
      TelemetryEventName.UploadResume,
      TelemetryEventName.UploadComplete,
    ]);
  });

  it('large_caption_mode_toggle은 발신하지 않는다 — T-W1-07a(subscriber) 귀속', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.wizardStepEnter('classify');
    events.wizardStepExit('classify');
    events.uploadStart('c1');
    events.uploadResume('c1');
    events.uploadComplete('c1');

    const names = request.mock.calls.flatMap((_, i) => bodyOf(request, i).map((e) => e.name));
    expect(names).not.toContain('large_caption_mode_toggle');
  });

  /**
   * ★ `mode_selected` 재도입 (T-W2-34, 대장 #123).
   * 여기 있던 부정 단언(`expect(names).not.toContain('mode_selected')`)은 T-W1-07b가 "간단 모드가
   * 존재하지 않는다"를 근거로 세운 고정이라, 간단 모드가 실제로 자막을 생략하게 된 지금은 **틀린
   * 고정**이다. 같은 자리를 긍정 단언으로 바꾼다 — 발신이 다시 사라지면 채택률 KPI가 조용히
   * 비어 버리므로 그쪽을 고정하는 편이 옳다.
   */
  it('modeSelected — 카탈로그 이름 + mode payload로 발신한다 (채택률 KPI의 유일 입력)', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.modeSelected(UploadMode.Simple);
    events.modeSelected(UploadMode.Precise);
    jest.advanceTimersByTime(TELEMETRY_FLUSH_INTERVAL_MS);

    // 배치 큐를 그대로 탄다 — 계측 전용 우회 경로를 만들지 않았다는 확인(대장 #128 ⓑ)
    expect(request).toHaveBeenCalledTimes(1);
    const body = bodyOf(request);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      name: TelemetryEventName.ModeSelected,
      payload: { mode: 'simple' },
    });
    expect(body[1]).toMatchObject({
      name: TelemetryEventName.ModeSelected,
      payload: { mode: 'precise' },
    });
    // sessionId가 붙어야 퍼널 이벤트와 같은 세션으로 상관된다
    expect(body[0]).toHaveProperty('sessionId');
  });

  it('modeSelected의 payload 값은 서버 롤업 분기와 같은 문자열이다', () => {
    // 서버(telemetry.service.ts)는 mode==='simple'/'precise'만 센다 — 어긋나면 조용히 어느 쪽으로도
    // 세지지 않는다(400도 아니라 실패가 보이지 않는다). shared에 payload 계약이 없어 이 단정이
    // 유일한 방어다.
    expect(UploadMode.Simple).toBe('simple');
    expect(UploadMode.Precise).toBe('precise');
  });
});

describe('createUploadFunnelEvents — 배치 전송 (대장 #128 ⓑ: 지사 NAT 공유 IP의 레이트리밋 조기 소진 방지)', () => {
  it('★ 이벤트 5건이 요청 1건으로 나간다 (기존: 이벤트마다 요청 1건 = 길이 1 배열 5회)', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.wizardStepEnter('classify', 'c1');
    events.wizardStepExit('classify', 'c1');
    events.wizardStepEnter('upload', 'c1');
    events.uploadStart('c1');
    expect(request).not.toHaveBeenCalled(); // 4건 모두 큐에 대기

    events.uploadComplete('c1'); // 종단 이벤트 → 강제 플러시

    expect(request).toHaveBeenCalledTimes(1);
    expect(bodyOf(request)).toHaveLength(5);
  });

  it('타이머 만료 전에는 전송하지 않고, 만료 시 쌓인 전부를 한 요청으로 보낸다', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.wizardStepEnter('classify', 'c1');
    events.uploadStart('c1');
    jest.advanceTimersByTime(TELEMETRY_FLUSH_INTERVAL_MS - 1);
    expect(request).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(bodyOf(request)).toHaveLength(2);
  });

  it('한 요청의 이벤트 수는 서버 배치 상한을 넘지 않는다(초과하면 서버가 배치 전체를 400으로 버린다)', async () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    for (let i = 0; i < TELEMETRY_MAX_BATCH_SIZE + 20; i += 1) events.uploadStart(`c${i}`);

    // 전송 완료(마이크로태스크) → 다음 타이머 → 반복하며 큐를 비운다
    for (let cycle = 0; cycle < 10; cycle += 1) {
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(TELEMETRY_FLUSH_INTERVAL_MS);
    }

    expect(request.mock.calls.length).toBeGreaterThan(1);
    for (const call of request.mock.calls) {
      expect((call[2] as { body: unknown[] }).body.length).toBeLessThanOrEqual(
        TELEMETRY_MAX_BATCH_SIZE,
      );
    }
  });
});

describe('createUploadFunnelEvents — 세션 상관자', () => {
  it('같은 팩토리 인스턴스의 모든 이벤트는 동일 sessionId를 공유한다', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.wizardStepEnter('classify');
    events.uploadComplete('c1'); // 강제 플러시 → 두 건이 한 배치로

    const body = bodyOf(request);
    expect(body).toHaveLength(2);
    expect(body[0]!.sessionId).toBeTruthy();
    expect(body[0]!.sessionId).toBe(body[1]!.sessionId);
  });

  it('classify.tsx·upload.tsx처럼 별도로 생성된 두 인스턴스도 같은 세션(모듈 싱글턴)을 공유한다 — 위저드 완주율 상관의 전제', () => {
    const { client: clientA } = makeClient();
    const { client: clientB, request: requestB } = makeClient();
    const classifyEvents = createUploadFunnelEvents(clientA);
    const uploadEvents = createUploadFunnelEvents(clientB);

    classifyEvents.wizardStepEnter('classify');
    uploadEvents.uploadComplete('c1');

    // 큐도 모듈 싱글턴이라 두 화면의 이벤트가 한 요청으로 합쳐진다(가장 최근 바인딩된 클라이언트로 전송)
    const body = bodyOf(requestB);
    expect(body).toHaveLength(2);
    expect(body[0]!.sessionId).toBe(body[1]!.sessionId);
  });

  it('__resetUploadFunnelTelemetryForTest 후에는 새 sessionId가 발급된다', () => {
    const { client, request: request1 } = makeClient();
    createUploadFunnelEvents(client).uploadComplete('c1');
    const sid1 = bodyOf(request1)[0]!.sessionId;

    __resetUploadFunnelTelemetryForTest();

    const { client: client2, request: request2 } = makeClient();
    createUploadFunnelEvents(client2).uploadComplete('c1');
    const sid2 = bodyOf(request2)[0]!.sessionId;

    expect(sid1).toBeTruthy();
    expect(sid2).not.toBe(sid1);
  });
});

describe('createUploadFunnelEvents — fire-and-forget (설계 제약: 계측 실패가 흐름을 막지 않는다)', () => {
  it('client.request가 거부돼도 호출부는 동기적으로 던지지 않는다', async () => {
    const request = jest.fn().mockRejectedValue(new Error('network down'));
    const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
    const events = createUploadFunnelEvents(client);

    expect(() => events.uploadComplete('c1')).not.toThrow();
    // 마이크로태스크 플러시 — .catch가 실제로 unhandled rejection 없이 처리됐는지 확인
    await Promise.resolve();
    await Promise.resolve();
  });

  it('반환값은 void — 호출부가 Promise를 기다릴 필요가 없다', () => {
    const { client } = makeClient();
    const events = createUploadFunnelEvents(client);
    expect(events.uploadStart('c1')).toBeUndefined();
  });
});
