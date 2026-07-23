import { ChatRateLimiter, TokenBucket } from './chat-rate-limiter';

describe('TokenBucket (순수·가짜 시계)', () => {
  it('capacity만큼 즉시 소비 후 부족', () => {
    const b = new TokenBucket(3, 1000, 0);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
  });

  it('refillMs 경과분만큼 회복(상한 capacity)', () => {
    const b = new TokenBucket(2, 1000, 0);
    b.take(0);
    b.take(0);
    expect(b.take(0)).toBe(false);
    // 1000ms 경과 → 1토큰 회복
    expect(b.take(1000)).toBe(true);
    expect(b.take(1000)).toBe(false);
    // 5000ms 경과 → 상한 2까지만
    expect(b.take(6000)).toBe(true);
    expect(b.take(6000)).toBe(true);
    expect(b.take(6000)).toBe(false);
  });

  it('retryAfterMs — 부족 시 다음 토큰까지 남은 시간', () => {
    const b = new TokenBucket(1, 1000, 0);
    b.take(0);
    expect(b.retryAfterMs(0)).toBe(1000);
    expect(b.retryAfterMs(400)).toBe(600);
  });
});

describe('ChatRateLimiter (소켓별 버킷)', () => {
  it('키별 독립 버킷 + 초과 시 retryAfterMs 안내', () => {
    let now = 0;
    const rl = new ChatRateLimiter(1, 1000, () => now);
    expect(rl.check('a').allowed).toBe(true);
    const denied = rl.check('a');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    // 다른 키는 독립
    expect(rl.check('b').allowed).toBe(true);
    // 시간 경과 후 회복
    now = 1000;
    expect(rl.check('a').allowed).toBe(true);
  });

  it('drop 후 버킷 초기화', () => {
    const now = 0;
    const rl = new ChatRateLimiter(1, 1000, () => now);
    rl.check('a');
    expect(rl.check('a').allowed).toBe(false);
    rl.drop('a');
    expect(rl.check('a').allowed).toBe(true);
  });
});
