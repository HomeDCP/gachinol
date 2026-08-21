import { TelemetryEventName } from '@gachinol/shared';
import { createTelemetrySender } from '../send-events';

const EVENT = {
  name: TelemetryEventName.CommerceLinkoutClick,
  payload: { liveSessionId: 'ls-1', productCardId: 'pc-1' },
} as const;

describe('createTelemetrySender — 링크아웃 유실 방지', () => {
  it('sendBeacon이 성공하면 fetch를 부르지 않는다(언로드 경합 회피)', () => {
    const sendBeacon = jest.fn().mockReturnValue(true);
    const fetchFn = jest.fn();

    createTelemetrySender({ baseUrl: 'https://api.test', sendBeacon, fetchFn }).send(EVENT);

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();

    const [url, body] = sendBeacon.mock.calls[0];
    expect(url).toBe('https://api.test/v1/telemetry/events');
    // 서버 계약: 배열 그 자체가 바디(래핑 객체 아님)
    expect(JSON.parse(body)).toEqual([EVENT]);
  });

  it('sendBeacon이 실패하면 keepalive fetch로 폴백한다', () => {
    const sendBeacon = jest.fn().mockReturnValue(false);
    const fetchFn = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));

    createTelemetrySender({ baseUrl: 'https://api.test', sendBeacon, fetchFn }).send(EVENT);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, init] = fetchFn.mock.calls[0];
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
    expect(JSON.parse(init.body)).toEqual([EVENT]);
  });

  it('baseUrl 끝의 슬래시가 중복 경로를 만들지 않는다', () => {
    const sendBeacon = jest.fn().mockReturnValue(true);
    createTelemetrySender({ baseUrl: 'https://api.test/', sendBeacon }).send(EVENT);

    expect(sendBeacon.mock.calls[0][0]).toBe('https://api.test/v1/telemetry/events');
  });

  it('전송이 던져도 호출자에게 예외가 새지 않는다 — 계측 실패가 링크아웃을 막으면 안 된다', () => {
    const sendBeacon = jest.fn().mockReturnValue(false);
    const fetchFn = jest.fn().mockImplementation(() => {
      throw new Error('network down');
    });

    const sender = createTelemetrySender({ baseUrl: 'https://api.test', sendBeacon, fetchFn });
    expect(() => sender.send(EVENT)).not.toThrow();
  });

  it('fetch가 거부해도 unhandled rejection이 되지 않는다', async () => {
    const sendBeacon = jest.fn().mockReturnValue(false);
    const fetchFn = jest.fn().mockRejectedValue(new Error('offline'));

    createTelemetrySender({ baseUrl: 'https://api.test', sendBeacon, fetchFn }).send(EVENT);
    await Promise.resolve();

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
