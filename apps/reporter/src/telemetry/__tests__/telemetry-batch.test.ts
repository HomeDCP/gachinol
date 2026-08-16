import { TELEMETRY_MAX_BATCH_SIZE, TelemetryEventName } from '@gachinol/shared';
import {
  admitEvent,
  createTelemetryBatchQueue,
  takeBatch,
  TELEMETRY_FLUSH_BATCH_SIZE,
  TELEMETRY_FLUSH_INTERVAL_MS,
} from '../telemetry-batch';

/** 이름은 항상 shared 카탈로그에서 — 리터럴을 쓰면 이 테스트가 drift를 놓친다 */
const event = (contentId: string) => ({
  name: TelemetryEventName.UploadStart,
  sessionId: 's1',
  contentId,
});

/** 큐 내부의 .then/.catch(마이크로태스크) 소진 — fake timer는 마이크로태스크를 진행시키지 않는다 */
const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

/* ───────────────────────────── 순수 함수 ───────────────────────────── */

describe('admitEvent — 큐 상한(오래된 것부터 드롭)', () => {
  it('상한 이하면 그대로 뒤에 붙는다', () => {
    const { queue, droppedOldest } = admitEvent([event('a')], event('b'), 5);
    expect(queue.map((e) => e.contentId)).toEqual(['a', 'b']);
    expect(droppedOldest).toBe(0);
  });

  it('상한 초과 시 가장 오래된 이벤트를 버린다(최신이 퍼널 종단에 가까워 KPI 가치가 크다)', () => {
    const { queue, droppedOldest } = admitEvent([event('a'), event('b')], event('c'), 2);
    expect(queue.map((e) => e.contentId)).toEqual(['b', 'c']);
    expect(droppedOldest).toBe(1);
  });

  it('입력 큐를 변형하지 않는다(순수)', () => {
    const original = [event('a')];
    admitEvent(original, event('b'), 5);
    expect(original).toHaveLength(1);
  });
});

describe('takeBatch — 서버 상한 하드가드', () => {
  it('앞에서 size만큼 잘라내고 나머지를 남긴다', () => {
    const { batch, rest } = takeBatch([event('a'), event('b'), event('c')], 2);
    expect(batch.map((e) => e.contentId)).toEqual(['a', 'b']);
    expect(rest.map((e) => e.contentId)).toEqual(['c']);
  });

  it(`요청 크기는 shared 상한(${TELEMETRY_MAX_BATCH_SIZE})을 절대 넘지 않는다 — 넘기면 서버가 배치 전체를 400으로 버린다`, () => {
    const queue = Array.from({ length: TELEMETRY_MAX_BATCH_SIZE + 50 }, (_, i) => event(`c${i}`));
    const { batch, rest } = takeBatch(queue, TELEMETRY_MAX_BATCH_SIZE + 999);
    expect(batch).toHaveLength(TELEMETRY_MAX_BATCH_SIZE);
    expect(rest).toHaveLength(50);
  });

  it('빈 큐는 빈 배치', () => {
    expect(takeBatch([], 10).batch).toHaveLength(0);
  });
});

it(`클라이언트 플러시 건수(${TELEMETRY_FLUSH_BATCH_SIZE})는 서버 배치 상한(${TELEMETRY_MAX_BATCH_SIZE}) 이하다`, () => {
  expect(TELEMETRY_FLUSH_BATCH_SIZE).toBeLessThanOrEqual(TELEMETRY_MAX_BATCH_SIZE);
});

/* ───────────────────────────── 배치 큐 ───────────────────────────── */

describe('createTelemetryBatchQueue — 플러시 조건 ①건수 ②시간 ③강제', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('②시간 — N건이 요청 1건으로 나간다(기존: 이벤트마다 요청 1건)', () => {
    const send = jest.fn().mockResolvedValue({ accepted: 3, unknownEventCount: 0 });
    const q = createTelemetryBatchQueue({ send });

    q.enqueue(event('a'));
    q.enqueue(event('b'));
    q.enqueue(event('c'));
    expect(send).not.toHaveBeenCalled(); // 아직 타이머 대기 중

    jest.advanceTimersByTime(TELEMETRY_FLUSH_INTERVAL_MS);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toHaveLength(3);
    q.dispose();
  });

  it('①건수 — flushBatchSize에 닿으면 타이머를 기다리지 않고 즉시 전송', () => {
    const send = jest.fn().mockResolvedValue({});
    const q = createTelemetryBatchQueue({ send, flushBatchSize: 3 });

    q.enqueue(event('a'));
    q.enqueue(event('b'));
    expect(send).not.toHaveBeenCalled();
    q.enqueue(event('c'));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toHaveLength(3);
    q.dispose();
  });

  it('③강제 — flush()는 타이머를 기다리지 않고 즉시 전송한다(백그라운드 전환·퍼널 종단)', () => {
    const send = jest.fn().mockResolvedValue({});
    const q = createTelemetryBatchQueue({ send });

    q.enqueue(event('a'));
    q.enqueue(event('b'));
    q.flush();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toHaveLength(2);
    q.dispose();
  });

  it('강제 플러시는 flushBatchSize가 아니라 서버 상한까지 실어 최대한 비운다(마지막 기회)', async () => {
    const send = jest.fn().mockResolvedValue({});
    const q = createTelemetryBatchQueue({ send, flushBatchSize: 2, maxQueuedEvents: 50 });

    // flushBatchSize(2)에 닿으면서 첫 배치가 나가고, 이후 in-flight라 나머지 8건은 큐에 쌓인다
    for (let i = 0; i < 10; i += 1) q.enqueue(event(`c${i}`));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toHaveLength(2);

    await flushPromises();
    q.flush();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toHaveLength(8); // flushBatchSize(2)가 아니라 남은 전부
    expect(q.stats().queued).toBe(0);
    q.dispose();
  });

  it('빈 큐에서 flush()는 아무것도 보내지 않는다(멱등 no-op)', () => {
    const send = jest.fn().mockResolvedValue({});
    const q = createTelemetryBatchQueue({ send });
    q.flush();
    expect(send).not.toHaveBeenCalled();
    q.dispose();
  });

  it('전송이 진행 중이면 새 플러시를 시작하지 않는다(요청 병렬화 금지)', () => {
    const send = jest.fn().mockReturnValue(new Promise(() => undefined)); // 영원히 pending
    const q = createTelemetryBatchQueue({ send, flushBatchSize: 2 });

    q.enqueue(event('a'));
    q.enqueue(event('b')); // 첫 배치 전송(펜딩)
    q.enqueue(event('c'));
    q.enqueue(event('d')); // 건수 조건을 다시 만족하지만 in-flight
    q.flush(); // 강제 플러시도 in-flight 중에는 no-op

    expect(send).toHaveBeenCalledTimes(1);
    expect(q.stats().queued).toBe(2);
    q.dispose();
  });

  it('전송 성공 후 남은 큐는 다음 타이머에 이어서 나간다', async () => {
    const send = jest.fn().mockResolvedValue({});
    const q = createTelemetryBatchQueue({ send, flushBatchSize: 2 });

    q.enqueue(event('a'));
    q.enqueue(event('b')); // 배치1 전송
    q.enqueue(event('c'));
    expect(send).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(TELEMETRY_FLUSH_INTERVAL_MS);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toHaveLength(1);
    expect(q.stats().eventsSent).toBe(2);
    q.dispose();
  });
});

describe('createTelemetryBatchQueue — 유실 정책(재시도 1회 + 백오프, 그다음은 버린다)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('전송 실패(429 등) 시 즉시 재시도하지 않고 백오프 뒤 같은 배치를 1회 재시도한다', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValue({});
    const q = createTelemetryBatchQueue({ send, retryBackoffMs: 10_000 });

    q.enqueue(event('a'));
    jest.advanceTimersByTime(TELEMETRY_FLUSH_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(1);

    await flushPromises();
    expect(q.stats().retriesScheduled).toBe(1);

    jest.advanceTimersByTime(9_000); // 백오프 미도달
    expect(send).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1_000); // 백오프 도달
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]); // 같은 배치

    await flushPromises();
    expect(q.stats().eventsSent).toBe(1);
    expect(q.stats().droppedBySendFailure).toBe(0);
    q.dispose();
  });

  it('재시도까지 실패하면 그 배치를 버린다(무한 재시도 큐를 만들지 않는다) — 유실은 카운터로 관측 가능', async () => {
    const send = jest.fn().mockRejectedValue(new Error('down'));
    const q = createTelemetryBatchQueue({ send, retryBackoffMs: 10_000 });

    q.enqueue(event('a'));
    q.enqueue(event('b'));
    jest.advanceTimersByTime(TELEMETRY_FLUSH_INTERVAL_MS);
    await flushPromises();

    jest.advanceTimersByTime(10_000); // 재시도
    await flushPromises();

    expect(send).toHaveBeenCalledTimes(2);
    expect(q.stats().droppedBySendFailure).toBe(2);
    expect(q.stats().queued).toBe(0);

    jest.advanceTimersByTime(60_000); // 더 이상 재시도하지 않는다
    expect(send).toHaveBeenCalledTimes(2);
    q.dispose();
  });

  it('큐 상한 초과분은 오래된 것부터 버리고 droppedByOverflow로 관측된다', () => {
    const send = jest.fn().mockReturnValue(new Promise(() => undefined));
    const q = createTelemetryBatchQueue({ send, flushBatchSize: 100, maxQueuedEvents: 3 });

    for (let i = 0; i < 5; i += 1) q.enqueue(event(`c${i}`));

    expect(q.stats().droppedByOverflow).toBe(2);
    expect(q.stats().queued).toBe(3);
    q.dispose();
  });

  it('send가 동기적으로 throw해도 호출부로 새어나가지 않는다(fire-and-forget)', async () => {
    const send = jest.fn(() => {
      throw new Error('boom');
    });
    const q = createTelemetryBatchQueue({ send: send as never, retryBackoffMs: 1_000 });

    expect(() => {
      q.enqueue(event('a'));
      q.flush();
    }).not.toThrow();

    await flushPromises();
    expect(q.stats().retriesScheduled).toBe(1);
    q.dispose();
  });

  it('dispose 후에는 적재도 전송도 하지 않는다(타이머 누수 방지)', () => {
    const send = jest.fn().mockResolvedValue({});
    const q = createTelemetryBatchQueue({ send });

    q.enqueue(event('a'));
    q.dispose();
    q.enqueue(event('b'));
    jest.advanceTimersByTime(60_000);

    expect(send).not.toHaveBeenCalled();
    expect(q.stats().queued).toBe(0);
  });
});
