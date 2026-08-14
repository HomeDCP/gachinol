import {
  extractClientIp,
  TelemetryIpRateLimiter,
  TelemetryTokenBucket,
} from './telemetry-rate-limiter';

describe('TelemetryTokenBucket (순수·가짜 시계)', () => {
  it('capacity만큼 즉시 소비 후 부족', () => {
    const b = new TelemetryTokenBucket(3, 1000, 0);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
  });

  it('refillMs 경과분만큼 회복(상한 capacity)', () => {
    const b = new TelemetryTokenBucket(2, 1000, 0);
    b.take(0);
    b.take(0);
    expect(b.take(0)).toBe(false);
    expect(b.take(1000)).toBe(true);
    expect(b.take(1000)).toBe(false);
    expect(b.take(6000)).toBe(true);
    expect(b.take(6000)).toBe(true);
    expect(b.take(6000)).toBe(false);
  });
});

describe('TelemetryIpRateLimiter (AC: 레이트리밋)', () => {
  it('capacity 초과 시 거절 + retryAfterMs 안내', () => {
    let now = 0;
    const rl = new TelemetryIpRateLimiter(1, 1000, 100, 60_000, 1000, () => now);

    expect(rl.check('1.2.3.4').allowed).toBe(true);
    const denied = rl.check('1.2.3.4');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);

    now = 1000;
    expect(rl.check('1.2.3.4').allowed).toBe(true);
  });

  it('IP(키)별 독립 버킷 — 한 IP의 소진이 다른 IP에 영향 없음', () => {
    const rl = new TelemetryIpRateLimiter(1, 1000, 100, 60_000, 1000, () => 0);
    expect(rl.check('1.1.1.1').allowed).toBe(true);
    expect(rl.check('1.1.1.1').allowed).toBe(false);
    expect(rl.check('2.2.2.2').allowed).toBe(true);
  });

  it('AC5 — maxKeys(레지스트리 상한) 도달 시 신규 IP는 429(레이트리미터 자신의 메모리 누수 방지)', () => {
    const rl = new TelemetryIpRateLimiter(10, 1000, 2, 60_000, 1000, () => 0);
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('b').allowed).toBe(true);
    expect(rl.trackedKeyCount).toBe(2);

    // 상한(2) 도달 후 신규 키 'c'는 토큰 여유와 무관하게 거절
    const denied = rl.check('c');
    expect(denied.allowed).toBe(false);
    expect(rl.trackedKeyCount).toBe(2);

    // 기존 추적 키(a·b)는 계속 정상 동작
    expect(rl.check('a').allowed).toBe(true); // a는 capacity=10이라 아직 여유
  });

  it('AC5 — 유휴 버킷은 idleTtlMs 경과 후 스윕되어 레지스트리 자리를 비운다', () => {
    let now = 0;
    const rl = new TelemetryIpRateLimiter(1, 1000, 1, /* idleTtlMs */ 5000, /* sweepIntervalMs */ 1000, () => now);

    expect(rl.check('a').allowed).toBe(true);
    expect(rl.trackedKeyCount).toBe(1);
    // 상한(1) 도달 상태에서 신규 키는 거절
    expect(rl.check('b').allowed).toBe(false);

    // a가 오래 유휴 상태(idleTtl 초과) + 스윕 주기 경과 → 다음 check 시 청소되어 자리가 빈다
    now = 10_000;
    expect(rl.check('b').allowed).toBe(true); // 스윕이 a를 제거한 뒤 b를 신규 등록
    expect(rl.trackedKeyCount).toBe(1);
  });

  it('sweepIntervalMs 미만 간격으로는 스윕을 반복 수행하지 않는다(스윕 비용 억제)', () => {
    let now = 0;
    const rl = new TelemetryIpRateLimiter(1, 1000, 1, 100, /* sweepIntervalMs */ 10_000, () => now);
    rl.check('a');
    now = 500; // idleTtl(100)은 넘었지만 sweepInterval(10000)은 안 지남
    expect(rl.check('b').allowed).toBe(false); // 아직 스윕 안 됨 → 상한 유지
    now = 20_000; // 이제 스윕 주기도 지남
    expect(rl.check('b').allowed).toBe(true);
  });
});

describe('extractClientIp — 신뢰 우선순위(CF-Connecting-IP > X-Forwarded-For > 소켓)', () => {
  it('AC① — CF-Connecting-IP가 있으면 X-Forwarded-For가 함께 와도 CF 값을 쓰고 XFF는 무시한다', () => {
    const req = {
      headers: {
        'cf-connecting-ip': '198.51.100.7',
        'x-forwarded-for': '10.0.0.1, 10.0.0.2', // 위조/오염 가능성이 있어도 CF가 있으면 안 본다
      },
      socket: { remoteAddress: '172.16.0.1' },
    };
    expect(extractClientIp(req)).toBe('198.51.100.7');
  });

  it('CF-Connecting-IP가 배열(다중 헤더)이면 첫 값을 사용', () => {
    const req = { headers: { 'cf-connecting-ip': ['198.51.100.7', '198.51.100.8'] } };
    expect(extractClientIp(req)).toBe('198.51.100.7');
  });

  it('AC② — CF-Connecting-IP가 없으면 X-Forwarded-For로 폴백(맨 앞 값, 콤마 구분·trim)', () => {
    const req = { headers: { 'x-forwarded-for': ' 203.0.113.5 , 10.0.0.1' } };
    expect(extractClientIp(req)).toBe('203.0.113.5');
  });

  it('X-Forwarded-For가 배열이면(다중 헤더) 첫 값을 사용', () => {
    const req = { headers: { 'x-forwarded-for': ['203.0.113.9', '203.0.113.10'] } };
    expect(extractClientIp(req)).toBe('203.0.113.9');
  });

  it('AC③ — CF-Connecting-IP·X-Forwarded-For 둘 다 없으면 소켓 remoteAddress로 폴백', () => {
    const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    expect(extractClientIp(req)).toBe('127.0.0.1');
  });

  it('셋 다 없으면 "unknown"', () => {
    const req = { headers: {} };
    expect(extractClientIp(req)).toBe('unknown');
  });

  it('빈 문자열 CF-Connecting-IP는 무시하고 다음 우선순위(XFF)로 폴백', () => {
    const req = { headers: { 'cf-connecting-ip': '', 'x-forwarded-for': '9.9.9.9' } };
    expect(extractClientIp(req)).toBe('9.9.9.9');
  });

  it('빈 문자열 X-Forwarded-For는 무시하고 소켓으로 폴백(위조/기형 헤더 방어)', () => {
    const req = { headers: { 'x-forwarded-for': '' }, socket: { remoteAddress: '9.9.9.9' } };
    expect(extractClientIp(req)).toBe('9.9.9.9');
  });
});
