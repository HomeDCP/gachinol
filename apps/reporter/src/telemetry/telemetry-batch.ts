import { TELEMETRY_MAX_BATCH_SIZE, type TelemetryEventEnvelope } from '@gachinol/shared';

/* ══════════════════════════════════════════════════════════════════════════
 * 계측 이벤트 배치 큐 (T-W2-29, 대장 #128 ⓑ).
 *
 * ── 왜 배치인가 ──────────────────────────────────────────────────────────
 * 서버는 `POST /v1/telemetry/events`를 **배열**로 받고 배치당 최대
 * `TELEMETRY_MAX_BATCH_SIZE`(=100)건을 허용하는데, 기존 클라이언트는 **항상 길이 1 배열**을 보냈다
 * (이벤트 1건 = HTTP 1건). 서버 레이트리밋은 **IP 단위**(토큰버킷 capacity 30 · 2초당 1개 회복 =
 * 지속 0.5 req/s)라, 지사에서 여러 기자가 **NAT 공유 IP**로 접속하면 상한에 불필요하게 빨리 닿는다.
 * 429는 클라이언트가 조용히 삼키므로(계측은 유실 허용 등급) 그 순간 관측이 통째로 사라진다.
 * 요청 수를 줄이는 것이 유일하게 클라이언트가 할 수 있는 대응이다.
 *
 * ── 플러시 조건 (셋 다 명시적) ────────────────────────────────────────────
 * ① **건수**: 큐 길이가 `flushBatchSize`(기본 20) 이상이면 즉시 전송.
 *    업로드 퍼널은 세션당 5~6건이라 이 조건에 잘 닿지 않는다 — 고빈도 트랙
 *    (`playback_progress` 등, 현재 미배선)이 붙었을 때를 위한 안전판이다.
 * ② **시간**: 첫 적재로부터 `flushIntervalMs`(기본 5초) 후 전송(타이머는 큐가 빌 때까지 재무장).
 * ③ **강제**: `flush()` — 앱 백그라운드 전환/웹 탭 숨김, 그리고 퍼널 종단 이벤트
 *    (`upload_complete`)처럼 놓치면 KPI가 깨지는 신호에서 호출부가 직접 부른다.
 *    강제 플러시는 **한 요청에 최대 `TELEMETRY_MAX_BATCH_SIZE`건까지** 실어 최대한 비운다.
 *
 * ── 유실 정책 (정직하게: 무엇을 버리고 무엇을 재시도하는가) ────────────────
 * 계측은 **유실 허용 등급**이다(업로드·저장 흐름을 절대 막지 않는다). 그러나 "조용히" 버리지는
 * 않는다 — 모든 유실은 `stats()`의 카운터로 관측 가능하다.
 *   1. **전송 실패(429 포함) → 그 배치를 큐 선두에 보관하고 `retryBackoffMs`(기본 10초) 뒤 1회만
 *      재시도**(`maxSendAttempts`=2 = 최초 1회 + 재시도 1회). 429의 원인이 "요청이 너무 잦음"이므로
 *      즉시 재시도는 상황을 악화시킬 뿐이라 반드시 백오프를 둔다. 백오프는 성공 시 해제된다.
 *   2. **재시도까지 실패하면 그 배치는 버린다**(`droppedBySendFailure`). 무한 재시도 큐를 만들지
 *      않는다 — 서버가 오래 죽어 있는 동안 메모리에 계측을 쌓는 것은 앱 사용자에게 아무 이득이 없다.
 *   3. **큐 상한 초과 → 가장 오래된 이벤트부터 버린다**(`droppedByOverflow`). 최신 이벤트가 퍼널
 *      종단(`upload_complete`)에 가까워 KPI 가치가 크므로 오래된 쪽을 희생한다.
 *   4. **전송 전 앱/탭 종료 → 유실**. 큐는 순수 인메모리이고 영속화하지 않는다. `flush()`가 마지막
 *      기회이며, 탭이 닫히는 중이면 in-flight fetch 자체가 취소될 수 있다(`navigator.sendBeacon`은
 *      도입하지 않는다 — ApiClient 경유를 유지한다). **이 한계는 설계상 수용한 것이다.**
 *   5. 전송이 이미 진행 중이면(`sending`) 새 플러시는 시작하지 않는다(요청 병렬화 금지 —
 *      레이트리밋을 줄이려는 목적과 정면으로 충돌). 진행 중 배치가 끝나면 남은 큐로 재무장한다.
 * ══════════════════════════════════════════════════════════════════════════ */

/** 이 건수 이상 쌓이면 즉시 전송 — 서버 상한(100)보다 훨씬 낮게 잡아 여유를 둔다 */
export const TELEMETRY_FLUSH_BATCH_SIZE = 20;
/** 시간 기준 플러시 간격(ms) — 사람이 느끼는 지연과 요청 절감의 절충 */
export const TELEMETRY_FLUSH_INTERVAL_MS = 5_000;
/** 큐에 담아두는 최대 이벤트 수 — 초과분은 오래된 것부터 버린다(메모리 유계) */
export const TELEMETRY_MAX_QUEUED_EVENTS = 200;
/** 전송 실패 후 재시도까지의 대기(ms) — 서버 토큰버킷 회복 간격(2초)보다 충분히 크게 */
export const TELEMETRY_RETRY_BACKOFF_MS = 10_000;
/** 배치당 최대 전송 시도 횟수(최초 1회 + 재시도 1회) */
export const TELEMETRY_MAX_SEND_ATTEMPTS = 2;

/* ───────────────────────────── 순수 함수 ───────────────────────────── */

export interface AdmitResult {
  queue: readonly TelemetryEventEnvelope[];
  /** 상한 초과로 버려진 "가장 오래된" 이벤트 수 */
  droppedOldest: number;
}

/** 큐에 1건 적재 — 상한 초과 시 오래된 쪽부터 밀어낸다(순수, 입력 큐를 변형하지 않는다) */
export function admitEvent(
  queue: readonly TelemetryEventEnvelope[],
  event: TelemetryEventEnvelope,
  maxQueuedEvents: number,
): AdmitResult {
  const cap = Math.max(1, maxQueuedEvents);
  const appended = [...queue, event];
  if (appended.length <= cap) return { queue: appended, droppedOldest: 0 };
  const droppedOldest = appended.length - cap;
  return { queue: appended.slice(droppedOldest), droppedOldest };
}

export interface TakeBatchResult {
  batch: readonly TelemetryEventEnvelope[];
  rest: readonly TelemetryEventEnvelope[];
}

/**
 * 큐 앞에서 배치를 잘라낸다(순수). 요청 크기는 **shared 상한을 절대 넘지 않는다** —
 * 넘기면 서버 zod가 배치 전체를 400으로 거부해 확정 유실이 된다.
 */
export function takeBatch(
  queue: readonly TelemetryEventEnvelope[],
  maxBatchSize: number,
): TakeBatchResult {
  const size = Math.max(1, Math.min(Math.floor(maxBatchSize), TELEMETRY_MAX_BATCH_SIZE));
  return { batch: queue.slice(0, size), rest: queue.slice(size) };
}

/* ───────────────────────────── 큐(상태 보유) ───────────────────────────── */

export interface TelemetryQueueStats {
  /** 아직 전송되지 않고 큐에 남아 있는 이벤트 수(재시도 대기분 포함) */
  queued: number;
  batchesSent: number;
  eventsSent: number;
  /** 실패 후 재시도가 예약된 횟수 */
  retriesScheduled: number;
  /** 큐 상한 초과로 버린 이벤트 수 */
  droppedByOverflow: number;
  /** 최대 시도 횟수를 소진해 버린 이벤트 수 */
  droppedBySendFailure: number;
}

export interface TelemetryBatchQueueOptions {
  /** 실제 전송기 — 거부(reject)는 실패로 간주된다. 동기 throw도 실패로 처리한다 */
  send: (batch: readonly TelemetryEventEnvelope[]) => Promise<unknown>;
  flushBatchSize?: number;
  flushIntervalMs?: number;
  maxQueuedEvents?: number;
  retryBackoffMs?: number;
  maxSendAttempts?: number;
  /** 테스트 DI — 기본 Date.now */
  now?: () => number;
}

export interface TelemetryBatchQueue {
  enqueue(event: TelemetryEventEnvelope): void;
  /** 강제 플러시(백그라운드 전환·퍼널 종단 이벤트) — 백오프를 무시하는 "마지막 기회" */
  flush(): void;
  stats(): TelemetryQueueStats;
  /** 타이머 정리 + 대기분 폐기(테스트·핫리로드 전용) */
  dispose(): void;
}

interface InFlightBatch {
  events: readonly TelemetryEventEnvelope[];
  /** 1 = 최초 전송 */
  attempt: number;
}

export function createTelemetryBatchQueue(options: TelemetryBatchQueueOptions): TelemetryBatchQueue {
  const {
    send,
    flushBatchSize = TELEMETRY_FLUSH_BATCH_SIZE,
    flushIntervalMs = TELEMETRY_FLUSH_INTERVAL_MS,
    maxQueuedEvents = TELEMETRY_MAX_QUEUED_EVENTS,
    retryBackoffMs = TELEMETRY_RETRY_BACKOFF_MS,
    maxSendAttempts = TELEMETRY_MAX_SEND_ATTEMPTS,
    now = () => Date.now(),
  } = options;

  let queue: readonly TelemetryEventEnvelope[] = [];
  /** 전송에 실패해 재시도를 기다리는 배치(큐보다 우선 전송 — 발생 순서 보존) */
  let pendingRetry: InFlightBatch | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sending = false;
  let backoffUntilMs = 0;
  let disposed = false;

  const counters = {
    batchesSent: 0,
    eventsSent: 0,
    retriesScheduled: 0,
    droppedByOverflow: 0,
    droppedBySendFailure: 0,
  };

  const hasWork = (): boolean => pendingRetry !== null || queue.length > 0;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleNext(): void {
    if (disposed || sending || timer !== null || !hasWork()) return;
    const backoffWait = backoffUntilMs - now();
    const delay = backoffWait > 0 ? backoffWait : flushIntervalMs;
    timer = setTimeout(() => {
      timer = null;
      flushInternal(false);
    }, delay);
  }

  function nextBatch(force: boolean): InFlightBatch | null {
    if (pendingRetry) {
      const batch = pendingRetry;
      pendingRetry = null;
      return batch;
    }
    // 강제 플러시는 "마지막 기회"라 한 요청에 최대한(서버 상한까지) 싣는다
    const { batch, rest } = takeBatch(queue, force ? TELEMETRY_MAX_BATCH_SIZE : flushBatchSize);
    if (batch.length === 0) return null;
    queue = rest;
    return { events: batch, attempt: 1 };
  }

  function onSendFailure(batch: InFlightBatch): void {
    if (batch.attempt < maxSendAttempts) {
      pendingRetry = { events: batch.events, attempt: batch.attempt + 1 };
      counters.retriesScheduled += 1;
    } else {
      counters.droppedBySendFailure += batch.events.length;
    }
    // 실패(특히 429) 직후 즉시 다음 배치를 쏘지 않는다 — 재시도든 후속 배치든 백오프를 지킨다
    backoffUntilMs = now() + retryBackoffMs;
    scheduleNext();
  }

  function flushInternal(force: boolean): void {
    if (disposed || sending) return;
    if (!force && backoffUntilMs > now()) {
      scheduleNext();
      return;
    }

    const batch = nextBatch(force);
    if (!batch) return;

    clearTimer();
    sending = true;

    let promise: Promise<unknown>;
    try {
      promise = Promise.resolve(send(batch.events));
    } catch (error) {
      promise = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    promise.then(
      () => {
        sending = false;
        counters.batchesSent += 1;
        counters.eventsSent += batch.events.length;
        backoffUntilMs = 0;
        scheduleNext();
      },
      () => {
        sending = false;
        onSendFailure(batch);
      },
    );
  }

  return {
    enqueue(event) {
      if (disposed) return;
      const admitted = admitEvent(queue, event, maxQueuedEvents);
      queue = admitted.queue;
      counters.droppedByOverflow += admitted.droppedOldest;

      if (queue.length >= flushBatchSize) flushInternal(false);
      else scheduleNext();
    },
    flush() {
      flushInternal(true);
    },
    stats() {
      return {
        queued: queue.length + (pendingRetry?.events.length ?? 0),
        ...counters,
      };
    },
    dispose() {
      clearTimer();
      disposed = true;
      queue = [];
      pendingRetry = null;
    },
  };
}
