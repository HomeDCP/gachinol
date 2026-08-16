// use-upload-funnel-events.ts는 useApiClient()를 위해 모듈 스코프에서 auth-context.tsx를
// import하고, auth-context.tsx는 다시 expo-router를 import한다. 실 expo-router는
// @react-navigation/native를 트랜지티브로 끌어오는데 그 패키지의 pnpm 플래튼 경로가
// jest.config.js의 transformIgnorePatterns 화이트리스트와 어긋나 raw ESM 파싱 실패를 낸다
// (auth-context.test.ts와 동일 사유·동일 해법 — reporter 전역 jest 설정은 이 태스크 소유 파일이
// 아니라 건드리지 않는다).
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

import type { ApiClient } from '../../api/client';
import {
  __resetUploadFunnelSessionIdForTest,
  createUploadFunnelEvents,
} from '../use-upload-funnel-events';

/** http-upload-service.test.ts와 동형 ApiClient 모의 — request만 검증 대상 */
function makeClient(): { client: ApiClient; request: jest.Mock } {
  const request = jest.fn().mockResolvedValue({ accepted: 1, unknownEventCount: 0 });
  const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
  return { client, request };
}

beforeEach(() => {
  __resetUploadFunnelSessionIdForTest();
});

describe('createUploadFunnelEvents — 발신 배선 (AC: 훅 호출이 실제 발생함을 모의 로거 호출 1회 이상으로 확인)', () => {
  test('wizardStepEnter — POST /telemetry/events에 upload_wizard_step_enter + step payload', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.wizardStepEnter('classify', 'content-1');

    expect(request).toHaveBeenCalledTimes(1);
    const [method, path, opts] = request.mock.calls[0]!;
    expect(method).toBe('POST');
    expect(path).toBe('/telemetry/events');
    expect((opts as { auth: boolean }).auth).toBe(false);
    const body = (opts as { body: unknown[] }).body;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      name: 'upload_wizard_step_enter',
      contentId: 'content-1',
      payload: { step: 'classify' },
    });
  });

  test('wizardStepExit — upload_wizard_step_exit + step payload', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.wizardStepExit('upload', 'content-1');

    expect(request).toHaveBeenCalledTimes(1);
    const body = (request.mock.calls[0]![2] as { body: unknown[] }).body;
    expect(body[0]).toMatchObject({ name: 'upload_wizard_step_exit', payload: { step: 'upload' } });
  });

  test('uploadStart — upload_start + contentId', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.uploadStart('content-1');

    const body = (request.mock.calls[0]![2] as { body: unknown[] }).body;
    expect(body[0]).toMatchObject({ name: 'upload_start', contentId: 'content-1' });
  });

  test('uploadResume — upload_resume + contentId (03§C-3 다시 시도 트리거)', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.uploadResume('content-1');

    const body = (request.mock.calls[0]![2] as { body: unknown[] }).body;
    expect(body[0]).toMatchObject({ name: 'upload_resume', contentId: 'content-1' });
  });

  test('uploadComplete — upload_complete + contentId', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.uploadComplete('content-1');

    const body = (request.mock.calls[0]![2] as { body: unknown[] }).body;
    expect(body[0]).toMatchObject({ name: 'upload_complete', contentId: 'content-1' });
  });

  test('large_caption_mode_toggle은 발신하지 않는다 — T-W1-07a(apps/subscriber) 소유 이벤트, DD1 귀속', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.wizardStepEnter('classify');
    events.wizardStepExit('classify');
    events.uploadStart('c1');
    events.uploadResume('c1');
    events.uploadComplete('c1');

    const names = request.mock.calls.map(
      (call) => (call[2] as { body: { name: string }[] }).body[0]!.name,
    );
    expect(names).not.toContain('large_caption_mode_toggle');
    expect(names).not.toContain('mode_selected');
  });
});

describe('createUploadFunnelEvents — 세션 상관자', () => {
  test('같은 팩토리 인스턴스의 모든 이벤트는 동일 sessionId를 공유한다', () => {
    const { client, request } = makeClient();
    const events = createUploadFunnelEvents(client);

    events.wizardStepEnter('classify');
    events.uploadComplete('c1');

    const sid0 = (request.mock.calls[0]![2] as { body: { sessionId: string }[] }).body[0]!.sessionId;
    const sid1 = (request.mock.calls[1]![2] as { body: { sessionId: string }[] }).body[0]!.sessionId;
    expect(sid0).toBeTruthy();
    expect(sid0).toBe(sid1);
  });

  test('classify.tsx·upload.tsx처럼 별도로 생성된 두 인스턴스도 같은 세션(모듈 싱글턴)을 공유한다 — 위저드 완주율 상관의 전제', () => {
    const { client: clientA, request: requestA } = makeClient();
    const { client: clientB, request: requestB } = makeClient();
    const classifyEvents = createUploadFunnelEvents(clientA);
    const uploadEvents = createUploadFunnelEvents(clientB);

    classifyEvents.wizardStepEnter('classify');
    uploadEvents.uploadComplete('c1');

    const sidClassify = (requestA.mock.calls[0]![2] as { body: { sessionId: string }[] }).body[0]!
      .sessionId;
    const sidUpload = (requestB.mock.calls[0]![2] as { body: { sessionId: string }[] }).body[0]!
      .sessionId;
    expect(sidClassify).toBe(sidUpload);
  });

  test('__resetUploadFunnelSessionIdForTest 후에는 새 sessionId가 발급된다', () => {
    const { client, request: request1 } = makeClient();
    createUploadFunnelEvents(client).uploadStart('c1');
    const sid1 = (request1.mock.calls[0]![2] as { body: { sessionId: string }[] }).body[0]!
      .sessionId;

    __resetUploadFunnelSessionIdForTest();

    const { client: client2, request: request2 } = makeClient();
    createUploadFunnelEvents(client2).uploadStart('c1');
    const sid2 = (request2.mock.calls[0]![2] as { body: { sessionId: string }[] }).body[0]!
      .sessionId;

    expect(sid2).not.toBe(sid1);
  });
});

describe('createUploadFunnelEvents — fire-and-forget (설계 제약: 계측 실패가 흐름을 막지 않는다)', () => {
  test('client.request가 거부돼도 호출부는 동기적으로 던지지 않는다', async () => {
    const request = jest.fn().mockRejectedValue(new Error('network down'));
    const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
    const events = createUploadFunnelEvents(client);

    expect(() => events.uploadStart('c1')).not.toThrow();
    // 마이크로태스크 플러시 — .catch가 실제로 unhandled rejection 없이 처리됐는지 확인
    await Promise.resolve();
    await Promise.resolve();
  });

  test('반환값은 void — 호출부가 Promise를 기다릴 필요가 없다', () => {
    const { client } = makeClient();
    const events = createUploadFunnelEvents(client);
    const result = events.uploadStart('c1');
    expect(result).toBeUndefined();
  });
});
