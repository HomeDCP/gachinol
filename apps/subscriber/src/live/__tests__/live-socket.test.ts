import { ApiClientError } from '../../api/errors';
import { createLiveSocket, type MinimalSocket } from '../live-socket';

type AnyFn = (...args: never[]) => void;

/** 테스트용 가짜 socket.io Socket — emitWithAck 응답 큐 + 리스너 레지스트리 */
class FakeSocket implements MinimalSocket {
  connected = true;
  disconnected = false;
  readonly emits: Array<{ event: string; arg: unknown }> = [];
  private ackQueue: unknown[] = [];
  private listeners = new Map<string, Set<AnyFn>>();

  queueAck(ack: unknown): void {
    this.ackQueue.push(ack);
  }
  emitWithAck(event: string, arg: unknown): Promise<unknown> {
    this.emits.push({ event, arg });
    return Promise.resolve(this.ackQueue.shift());
  }
  on(event: string, listener: AnyFn): void {
    (this.listeners.get(event) ?? this.listeners.set(event, new Set()).get(event)!).add(listener);
  }
  off(event: string, listener: AnyFn): void {
    this.listeners.get(event)?.delete(listener);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  /** 서버→클라 이벤트 방출 시뮬레이션 */
  fire(event: string, payload: unknown): void {
    for (const l of this.listeners.get(event) ?? []) (l as (p: unknown) => void)(payload);
  }
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

function setup() {
  const fake = new FakeSocket();
  const socket = createLiveSocket({
    url: 'http://api.test',
    nickname: '해녀삼춘',
    socketFactory: (url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return fake;
    },
  });
  return { fake, socket };
}
let capturedUrl = '';
let capturedOpts: unknown = null;

describe('createLiveSocket', () => {
  test('핸드셰이크: auth.nickname + websocket 전송 + 재연결', () => {
    setup();
    expect(capturedUrl).toBe('http://api.test');
    expect(capturedOpts).toEqual({
      auth: { nickname: '해녀삼춘' },
      transports: ['websocket'],
      reconnection: true,
    });
  });

  test('joinLive: ok ack → LiveJoinAck 반환', async () => {
    const { fake, socket } = setup();
    const ack = { ok: true, data: { session: { id: 'live1' }, recentChat: [] } };
    fake.queueAck(ack);
    const result = await socket.joinLive('live1' as never);
    expect(result).toEqual(ack.data);
    expect(fake.emits[0]).toEqual({ event: 'live.join', arg: { liveSessionId: 'live1' } });
  });

  test('sendChat: ok ack → ChatMessage, 페이로드에 nickname 없음(핸드셰이크 전용)', async () => {
    const { fake, socket } = setup();
    fake.queueAck({ ok: true, data: { id: 'c1', message: '안녕' } });
    const msg = await socket.sendChat('live1' as never, '안녕');
    expect(msg).toEqual({ id: 'c1', message: '안녕' });
    expect(fake.emits[0]).toEqual({
      event: 'chat.send',
      arg: { liveSessionId: 'live1', message: '안녕' },
    });
    expect(fake.emits[0]!.arg).not.toHaveProperty('nickname');
  });

  test('레이트리밋 ack(ok:false) → ApiClientError(validation_failed, status 400, details 보존)', async () => {
    const { fake, socket } = setup();
    fake.queueAck({
      ok: false,
      error: {
        code: 'validation_failed',
        message: '메시지를 너무 빠르게 보냈습니다',
        details: { reason: 'rate_limited', retryAfterMs: 800 },
      },
    });
    const err = await socket.sendChat('live1' as never, 'spam').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(400);
    expect((err as ApiClientError).code).toBe('validation_failed');
    expect((err as ApiClientError).error.details).toEqual({
      reason: 'rate_limited',
      retryAfterMs: 800,
    });
  });

  test('conflict ack → status 409', async () => {
    const { fake, socket } = setup();
    fake.queueAck({ ok: false, error: { code: 'conflict', message: '참여할 수 없는 라이브 상태입니다' } });
    const err = await socket.joinLive('live1' as never).catch((e: unknown) => e);
    expect((err as ApiClientError).status).toBe(409);
  });

  test('on*/off: 구독 후 방출 수신, 언구독 후 미수신', () => {
    const { fake, socket } = setup();
    const got: unknown[] = [];
    const off = socket.onChatNew((m) => got.push(m));
    expect(fake.listenerCount('chat.new')).toBe(1);
    fake.fire('chat.new', { id: 'c1' });
    off();
    fake.fire('chat.new', { id: 'c2' });
    expect(got).toEqual([{ id: 'c1' }]);
    expect(fake.listenerCount('chat.new')).toBe(0);
  });

  test('onConnect: connect 이벤트 구독(재연결 재조인 트리거)', () => {
    const { fake, socket } = setup();
    let hits = 0;
    socket.onConnect(() => (hits += 1));
    fake.fire('connect', undefined);
    fake.fire('connect', undefined);
    expect(hits).toBe(2);
  });

  test('close → disconnect 호출', () => {
    const { fake, socket } = setup();
    socket.close();
    expect(fake.disconnected).toBe(true);
  });
});
