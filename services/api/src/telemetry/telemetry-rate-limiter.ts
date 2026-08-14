import type { Request } from 'express';

/* ══════════════════════════════════════════════════════════════════════════
 * IP 기준 토큰버킷 레이트리밋 — 대장 #79 조치④.
 *
 * `services/api/src/live/chat-rate-limiter.ts`의 구조(TokenBucket + 키별 레지스트리)를 참고해
 * telemetry 전용으로 새로 작성한다. 그 파일은 소켓 연결 전용(연결 종료 시 게이트웨이가 명시적으로
 * drop 호출)이라 그대로 재사용할 수 없다 — 이 모듈은 HTTP 요청이라 "연결 종료" 신호가 없고, 대신
 * ① 키가 클라이언트 IP(추정치)라는 점, ② 레지스트리 자체가 무한정 자라지 않도록 유휴 버킷을
 * 스스로 청소해야 한다는 점에서 구조가 갈린다(요구사항 5).
 *
 * ── 클라이언트 IP 신뢰 순위 (반드시 읽을 것) ────────────────────────────────
 * 이 api는 Cloudflare Quick Tunnel(cloudflared) 뒤에 배포되어 있다: 인터넷 → Cloudflare 엣지 →
 * cloudflared → nginx → api. 소켓의 `remoteAddress`는 터널 프로세스 자신을 가리키므로 쓸모없다.
 *
 * ① **`CF-Connecting-IP`(최우선)** — Cloudflare 엣지가 TCP 연결의 실제 발신 IP를 보고 **직접** 써
 * 넣는 헤더다. 클라이언트가 이 헤더를 실어 보내도 엣지가 항상 재작성하므로 **클라이언트가 위조할 수
 * 없다**(Cloudflare 엣지를 거치지 않고는 이 헤더에 도달할 방법이 없다). 이 값이 있으면 이것만 쓰고
 * 아래 X-Forwarded-For는 무시한다 — 더 신뢰할 수 있는 신호가 있는데 약한 신호를 섞을 이유가 없다.
 *
 * ② **`X-Forwarded-For`(폴백, 신뢰도 낮음)** — CF 헤더가 없을 때만 쓴다(로컬 개발·LAN 검증·SSH
 * 터널 경유처럼 Cloudflare 엣지를 거치지 않는 경로). 이 헤더는 **클라이언트가 임의로 실어 보낼 수
 * 있는 값**이다(신뢰할 수 있는 리버스 프록시가 앞단에서 값을 덮어쓰거나 `trust proxy` 체인을
 * 엄격히 검증하지 않는 한 위조 가능). 즉 **CF 뒤가 아닌 경로에서는** 공격자가 매 요청마다 다른
 * `X-Forwarded-For` 값을 실어 IP별 버킷을 무한정 새로 발급받아 이 레이트리밋을 완전히 우회할 수
 * 있다 — 이 폴백은 "일부 우회 가능"을 인지한 상태의 약한 완화책이지 강한 신원 증명이 아니다.
 * (완화책: 아래 `maxKeys` 상한이 "신규 키 무한 발급으로 레지스트리를 고갈시키는" 2차 공격까지는
 * 막아주지만, "한 공격자가 무제한 요청을 보내는 것" 자체를 막지는 못한다.) **CF-Connecting-IP가
 * 있는 한(=현재 프로덕션 경로) 이 취약점은 닫혀 있다** — 실사용 배포 경로에서만 안전하다는 뜻이며,
 * 이 폴백 코드를 지우면 안 되는 이유이기도 하다(로컬·LAN·SSH 터널 검증 경로가 여전히 존재).
 *
 * ③ **소켓 `remoteAddress`(최후 폴백)** — ①②가 전부 없을 때만. 직결 환경(테스트)에서만 정확하다.
 * ══════════════════════════════════════════════════════════════════════════ */

/** IP당 버스트 허용량 — 이벤트는 배치(최대 100건)로 오므로 한 화면 세션에서 여러 배치가 짧게 몰려도
 *  통과할 만큼 여유를 둔다. env 미도입(고정 상수로 충분). */
export const TELEMETRY_RATE_LIMIT_CAPACITY = 30;
/** 토큰 1개 회복 간격(ms) — capacity 소진 후 지속 처리율 ≈ 0.5 요청/초/IP */
export const TELEMETRY_RATE_LIMIT_REFILL_MS = 2000;
/** 동시 추적 IP(버킷) 최대 수 — 상한 도달 후 신규 IP는 429로 거절한다(레지스트리 자체의 무한 증가
 *  방지 + X-Forwarded-For 회전으로 신규 키를 무한 발급받는 우회 공격도 함께 봉쇄). */
export const TELEMETRY_RATE_LIMIT_MAX_IPS = 10_000;
/** 이 시간(ms) 이상 요청이 없었던 버킷은 청소 대상 — 정상 트래픽 IP가 실수로 지워지지 않도록
 *  refill 주기(2s)보다 훨씬 크게(10분) 잡는다 */
export const TELEMETRY_RATE_LIMIT_IDLE_TTL_MS = 10 * 60_000;
/** 청소는 매 요청마다 전체 스윕하지 않고 최소 이 간격(ms)마다 1회로 제한(스윕 자체의 비용 억제) */
export const TELEMETRY_RATE_LIMIT_SWEEP_INTERVAL_MS = 60_000;

/** 순수 토큰버킷 — `live/chat-rate-limiter.ts`의 TokenBucket과 동일한 알고리즘(중복 구현, import 금지) */
export class TelemetryTokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillMs: number,
    nowMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = nowMs;
  }

  take(nowMs: number): boolean {
    this.refill(nowMs);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  retryAfterMs(nowMs: number): number {
    this.refill(nowMs);
    if (this.tokens >= 1) return 0;
    const elapsed = nowMs - this.lastRefillMs;
    return Math.max(0, this.refillMs - elapsed);
  }

  private refill(nowMs: number): void {
    if (this.refillMs <= 0) return;
    const elapsed = nowMs - this.lastRefillMs;
    if (elapsed <= 0) return;
    const gained = Math.floor(elapsed / this.refillMs);
    if (gained > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + gained);
      this.lastRefillMs += gained * this.refillMs;
    }
  }
}

/**
 * IP 키 → 버킷 레지스트리. `TelemetryController`가 싱글턴으로 보유(프로세스 생애주기 동안 유지,
 * `TelemetryRollup`과 동형 — DI 불요, 순수 클래스라 단위 테스트가 가짜 시계로 직접 구성 가능).
 */
export class TelemetryIpRateLimiter {
  private readonly buckets = new Map<string, { bucket: TelemetryTokenBucket; lastSeenMs: number }>();
  private lastSweepMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillMs: number,
    private readonly maxKeys: number,
    private readonly idleTtlMs: number,
    private readonly sweepIntervalMs: number,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.lastSweepMs = this.clock();
  }

  /** 통과 시 {allowed:true}, 초과 또는 레지스트리 포화 시 {allowed:false, retryAfterMs} */
  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = this.clock();
    this.sweepIfDue(now);

    let entry = this.buckets.get(key);
    if (!entry) {
      if (this.buckets.size >= this.maxKeys) {
        // 레지스트리 포화 — 신규 키(신규 IP 또는 X-Forwarded-For 회전으로 위조된 새 키)를 무제한
        // 발급하면 이 레이트리미터 자신이 메모리 누수원이 된다(요구사항 5). 이 요청은 거절하고
        // refillMs를 재시도 안내로 사용한다(정확한 값은 아니지만 "잠시 후 재시도" 신호로 충분).
        return { allowed: false, retryAfterMs: this.refillMs };
      }
      entry = { bucket: new TelemetryTokenBucket(this.capacity, this.refillMs, now), lastSeenMs: now };
      this.buckets.set(key, entry);
    }
    entry.lastSeenMs = now;

    if (entry.bucket.take(now)) return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: entry.bucket.retryAfterMs(now) };
  }

  /** 유휴 버킷 청소 — 매 호출마다 전체 스윕하지 않고 sweepIntervalMs 이상 지났을 때만 수행 */
  private sweepIfDue(now: number): void {
    if (now - this.lastSweepMs < this.sweepIntervalMs) return;
    this.lastSweepMs = now;
    for (const [key, entry] of this.buckets) {
      if (now - entry.lastSeenMs > this.idleTtlMs) this.buckets.delete(key);
    }
  }

  /** 현재 추적 중인 버킷(IP) 수 — 관측·테스트용 */
  get trackedKeyCount(): number {
    return this.buckets.size;
  }
}

/**
 * 요청에서 클라이언트 IP(추정치)를 뽑는다 — 우선순위는 위 "클라이언트 IP 신뢰 순위" 참고:
 * ① `CF-Connecting-IP`(Cloudflare 엣지가 직접 기록, 위조 불가 — 있으면 이것만 쓰고 끝)
 * ② `X-Forwarded-For`(CF 헤더 없을 때만 폴백. `client, proxy1, proxy2, ...` 관례상 맨 앞 값을
 *    취하지만, 이 값 자체가 클라이언트發 위조 가능 — CF 뒤가 아닌 경로에서는 이 레이트리밋이
 *    위조로 우회될 수 있다는 뜻이다. 지우지 말 것: 로컬·LAN·SSH 터널 검증 경로에 필요하다)
 * ③ 소켓 remoteAddress(둘 다 없을 때 최후 폴백, 직결 환경에서만 정확)
 */
export const extractClientIp = (
  req: Pick<Request, 'headers'> & { socket?: { remoteAddress?: string | null } },
): string => {
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  const cfRaw = Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp;
  const cfFirst = cfRaw?.trim();
  if (cfFirst) return cfFirst;

  // CF-Connecting-IP가 없을 때만 도달 — 아래는 위조 가능한 약한 폴백(위 주석 참고)
  const xff = req.headers['x-forwarded-for'];
  const xffRaw = Array.isArray(xff) ? xff[0] : xff;
  const xffFirst = xffRaw?.split(',')[0]?.trim();
  if (xffFirst) return xffFirst;

  return req.socket?.remoteAddress ?? 'unknown';
};
