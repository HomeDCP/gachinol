import type { Queue } from 'bullmq';
import type { DcpArbiterState } from './arbiter-policy';
import type { DcpArbiterClient } from './dcp-arbiter.client';
import { DcpArbiterService } from './dcp-arbiter.service';

/** env 기본값과 동일하게 동작하는 ConfigService 스텁 */
const makeConfig = (over: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    DCP_ARBITER_POLL_MS: 30000,
    DCP_ARBITER_TIMEOUT_MS: 5000,
    DCP_ARBITER_HOLD_ON_IMMINENT: true,
    DCP_ARBITER_FAIL_MODE: 'hold',
    ...over,
  };
  return { get: (k: string) => values[k] } as never;
};

const makeQueue = (paused = false) => ({
  pause: jest.fn().mockResolvedValue(undefined),
  resume: jest.fn().mockResolvedValue(undefined),
  isPaused: jest.fn().mockResolvedValue(paused),
});

const makeClient = (state: DcpArbiterState | null, baseUrl: string | null = 'http://dcp:8080') =>
  ({
    baseUrl,
    fetchState: jest.fn().mockResolvedValue(state),
    subscribe: jest.fn().mockReturnValue(() => undefined),
  }) as unknown as DcpArbiterClient & { fetchState: jest.Mock; subscribe: jest.Mock };

const idle: DcpArbiterState = { busy: false, stage: null, queued: 0, since: null };
const busy: DcpArbiterState = { busy: true, stage: 'encoding', queued: 1, since: '2026-07-30T00:00:00Z' };

describe('DcpArbiterService', () => {
  it('DCP_ARBITER_URL 미설정 → 비활성, 큐를 건드리지 않는다', async () => {
    const queue = makeQueue();
    const svc = new DcpArbiterService(queue as unknown as Queue, makeClient(idle, null), makeConfig());

    await svc.onModuleInit();

    expect(svc.enabled).toBe(false);
    expect(queue.pause).not.toHaveBeenCalled();
    expect(svc.state.message).toBe('처리 가능');
  });

  it('REDIS_URL 미설정(큐 없음) → 비활성', async () => {
    const svc = new DcpArbiterService(null, makeClient(busy), makeConfig());
    await svc.onModuleInit();
    expect(svc.enabled).toBe(false);
  });

  it('busy → 큐 정지 + 사유 노출', async () => {
    const queue = makeQueue();
    const svc = new DcpArbiterService(queue as unknown as Queue, makeClient(busy), makeConfig());

    await svc.refresh();

    expect(queue.pause).toHaveBeenCalledTimes(1);
    expect(svc.state.holding).toBe(true);
    expect(svc.state.reason).toBe('dcp_busy');
    expect(svc.state.dcp).toEqual(busy);
    expect(svc.state.message).toContain('encoding');
  });

  it('busy가 이어지면 pause를 반복 호출하지 않는다', async () => {
    const queue = makeQueue();
    const svc = new DcpArbiterService(queue as unknown as Queue, makeClient(busy), makeConfig());

    await svc.refresh();
    await svc.refresh();
    await svc.refresh();

    expect(queue.pause).toHaveBeenCalledTimes(1);
  });

  it('busy → idle 전이 시 재개한다', async () => {
    const queue = makeQueue();
    const client = makeClient(busy);
    const svc = new DcpArbiterService(queue as unknown as Queue, client, makeConfig());

    await svc.refresh();
    client.fetchState.mockResolvedValue(idle);
    await svc.refresh();

    expect(queue.resume).toHaveBeenCalledTimes(1);
    expect(svc.state.holding).toBe(false);
    expect(svc.state.reason).toBeNull();
  });

  it('조회 실패 → 기본 정책(hold)으로 정지', async () => {
    const queue = makeQueue();
    const svc = new DcpArbiterService(queue as unknown as Queue, makeClient(null), makeConfig());

    await svc.refresh();

    expect(queue.pause).toHaveBeenCalledTimes(1);
    expect(svc.state.reason).toBe('dcp_unreachable');
  });

  it('failMode=run이면 조회 실패에도 진행한다', async () => {
    const queue = makeQueue();
    const svc = new DcpArbiterService(
      queue as unknown as Queue,
      makeClient(null),
      makeConfig({ DCP_ARBITER_FAIL_MODE: 'run' }),
    );

    await svc.refresh();

    expect(queue.pause).not.toHaveBeenCalled();
    expect(svc.state.holding).toBe(false);
  });

  it('동시 refresh는 합쳐진다(SSE 폭주 시 중복 조회 방지)', async () => {
    const queue = makeQueue();
    const client = makeClient(idle);
    let resolve!: (v: DcpArbiterState) => void;
    client.fetchState.mockReturnValueOnce(new Promise<DcpArbiterState>((r) => (resolve = r)));
    const svc = new DcpArbiterService(queue as unknown as Queue, client, makeConfig());

    const first = svc.refresh();
    void svc.refresh(); // 진행 중 → 합류
    void svc.refresh();
    resolve(idle);
    await first;

    // 1회(진행 중) + 1회(대기분 합산) = 2회. 호출 3회가 그대로 3회 조회로 가지 않는다
    expect(client.fetchState).toHaveBeenCalledTimes(2);
  });

  // BullMQ pause는 Redis에 영속된다 — 이전 프로세스가 정지시킨 채 죽으면 큐가 영구 정지될 수 있다
  describe('부팅 시 실제 큐 상태에서 출발한다', () => {
    it('이전 기동이 남긴 정지 + 지금 DCP 유휴 → 재개한다', async () => {
      const queue = makeQueue(true); // Redis에 pause가 남아 있는 상태
      const svc = new DcpArbiterService(queue as unknown as Queue, makeClient(idle), makeConfig());

      await svc.onModuleInit();

      expect(queue.resume).toHaveBeenCalledTimes(1);
      expect(svc.state.holding).toBe(false);
    });

    it('이전 기동이 남긴 정지 + 지금도 DCP busy → 중복 pause 없이 정지 유지', async () => {
      const queue = makeQueue(true);
      const svc = new DcpArbiterService(queue as unknown as Queue, makeClient(busy), makeConfig());

      await svc.onModuleInit();

      expect(queue.pause).not.toHaveBeenCalled(); // 이미 정지 상태
      expect(queue.resume).not.toHaveBeenCalled();
      expect(svc.state.holding).toBe(true);
    });
  });

  it('종료 시 정지 상태를 남기지 않는다 — 큐 영구 정지 방지', async () => {
    const queue = makeQueue();
    const svc = new DcpArbiterService(queue as unknown as Queue, makeClient(busy), makeConfig());

    await svc.refresh();
    expect(svc.state.holding).toBe(true);
    await svc.onModuleDestroy();

    expect(queue.resume).toHaveBeenCalledTimes(1);
  });

  it('pause 실패 시 상태를 바꾸지 않는다(다음 주기 재시도)', async () => {
    const queue = makeQueue();
    queue.pause.mockRejectedValueOnce(new Error('redis down'));
    const svc = new DcpArbiterService(queue as unknown as Queue, makeClient(busy), makeConfig());

    await svc.refresh();

    expect(svc.state.holding).toBe(false); // 정지에 실패했으므로 holding을 참칭하지 않는다
    await svc.refresh(); // 다음 주기에 재시도
    expect(queue.pause).toHaveBeenCalledTimes(2);
    expect(svc.state.holding).toBe(true);
  });
});
