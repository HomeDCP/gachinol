import { ApiClientError } from '../../api/errors';
import { createControlSocket, type ControlSocketOptions, type MinimalSocket } from '../live-socket';

type AnyFn = (...args: never[]) => void;

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
  fire(event: string, payload: unknown): void {
    for (const l of this.listeners.get(event) ?? []) (l as (p: unknown) => void)(payload);
  }
}

/** auth 함수를 호출해 socket.io가 넘겨줄 토큰 객체를 관측 */
async function resolveAuth(opts: ControlSocketOptions): Promise<Record<string, unknown>> {
  return new Promise((resolve) => opts.auth((data) => resolve(data)));
}

function setup(getToken: () => Promise<string | null>) {
  const fake = new FakeSocket();
  let capturedOpts: ControlSocketOptions | null = null;
  const socket = createControlSocket({
    url: 'http://api.test',
    getToken,
    socketFactory: (_url, opts) => {
      capturedOpts = opts;
      return fake;
    },
  });
  return { fake, socket, getOpts: () => capturedOpts! };
}

describe('createControlSocket', () => {
  test('핸드셰이크: 함수형 auth가 getToken()의 최신 access를 실어 보낸다', async () => {
    const { getOpts } = setup(() => Promise.resolve('access-1'));
    const data = await resolveAuth(getOpts());
    expect(data).toEqual({ token: 'access-1' });
  });

  test('재연결 재-auth: getToken이 매 호출마다 최신 토큰 반환(회전 반영)', async () => {
    let n = 0;
    const { getOpts } = setup(() => Promise.resolve(`access-${(n += 1)}`));
    expect(await resolveAuth(getOpts())).toEqual({ token: 'access-1' });
    expect(await resolveAuth(getOpts())).toEqual({ token: 'access-2' });
  });

  test('토큰 없음(null) → 빈 문자열 전달(서버 게이트가 거절, 연결은 유지)', async () => {
    const { getOpts } = setup(() => Promise.resolve(null));
    expect(await resolveAuth(getOpts())).toEqual({ token: '' });
  });

  test('getToken reject → 빈 토큰으로 폴백(연결 유지)', async () => {
    const { getOpts } = setup(() => Promise.reject(new Error('refresh 실패')));
    expect(await resolveAuth(getOpts())).toEqual({ token: '' });
  });

  test('prompterJoin: ok ack → PrompterJoinAck', async () => {
    const { fake, socket } = setup(() => Promise.resolve('t'));
    fake.queueAck({ ok: true, data: { recentComments: [] } });
    const ack = await socket.prompterJoin('live1' as never);
    expect(ack).toEqual({ recentComments: [] });
    expect(fake.emits[0]).toEqual({ event: 'prompter.join', arg: { liveSessionId: 'live1' } });
  });

  test('prompterJoin 미인증 → ApiClientError(unauthorized, 401)', async () => {
    const { fake, socket } = setup(() => Promise.resolve(''));
    fake.queueAck({ ok: false, error: { code: 'unauthorized', message: '인증이 필요합니다' } });
    const err = await socket.prompterJoin('live1' as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(401);
  });

  test('prompterJoin 권한 미달 → forbidden(403)', async () => {
    const { fake, socket } = setup(() => Promise.resolve('t'));
    fake.queueAck({ ok: false, error: { code: 'forbidden', message: '권한 없음' } });
    const err = await socket.prompterJoin('live1' as never).catch((e: unknown) => e);
    expect((err as ApiClientError).status).toBe(403);
  });

  test('controlJoin: ok ack → void, 빈 페이로드', async () => {
    const { fake, socket } = setup(() => Promise.resolve('t'));
    fake.queueAck({ ok: true, data: null });
    await expect(socket.controlJoin()).resolves.toBeUndefined();
    expect(fake.emits[0]).toEqual({ event: 'control.join', arg: {} });
  });

  test('onPrompterComments/onLiveStatus 구독·수신, onConnect(재연결 재조인 트리거)', () => {
    const { fake, socket } = setup(() => Promise.resolve('t'));
    const batches: unknown[] = [];
    const off = socket.onPrompterComments((p) => batches.push(p));
    let connects = 0;
    socket.onConnect(() => (connects += 1));
    fake.fire('prompter.comments', { liveSessionId: 'live1', comments: [] });
    off();
    fake.fire('prompter.comments', { liveSessionId: 'live1', comments: [{ id: 'x' }] });
    fake.fire('connect', undefined);
    expect(batches).toEqual([{ liveSessionId: 'live1', comments: [] }]);
    expect(connects).toBe(1);
  });

  test('close → disconnect', () => {
    const { fake, socket } = setup(() => Promise.resolve('t'));
    socket.close();
    expect(fake.disconnected).toBe(true);
  });
});
