/**
 * 소켓별 토큰버킷 레이트리밋 — 순수(가짜 시계 주입 가능)라 단위 테스트 용이.
 * capacity개 버스트 허용, refillMs마다 1토큰 회복. take()가 false면 호출측이 rate_limited로 거절.
 */
export class TokenBucket {
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

  /** 1토큰 소비 시도. 성공 true / 부족 false. nowMs 기준 회복분을 먼저 반영한다. */
  take(nowMs: number): boolean {
    this.refill(nowMs);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** 다음 토큰까지 남은 ms — 거절 시 retryAfterMs 안내용 */
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
 * 소켓 키(guestId/userId) → 버킷 레지스트리. 게이트웨이가 소유(연결 해제 시 drop).
 * capacity/refillMs는 env(LIVE_CHAT_RATE_*)에서 주입.
 */
export class ChatRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillMs: number,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** 통과 시 {allowed:true}, 초과 시 {allowed:false, retryAfterMs} */
  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = this.clock();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.refillMs, now);
      this.buckets.set(key, bucket);
    }
    if (bucket.take(now)) return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: bucket.retryAfterMs(now) };
  }

  drop(key: string): void {
    this.buckets.delete(key);
  }
}
