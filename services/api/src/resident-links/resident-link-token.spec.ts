import { createHash } from 'node:crypto';
import {
  generateResidentLinkToken,
  hashResidentLinkToken,
  isResidentLinkTokenShape,
  RESIDENT_LINK_TOKEN_BYTES,
} from './resident-link-token';

describe('링크 토큰 (AC5: 추측 불가능 + 원문 미저장)', () => {
  it('CSPRNG 32바이트 → base64url 43자, 매번 다른 값', () => {
    expect(RESIDENT_LINK_TOKEN_BYTES).toBe(32);
    const tokens = new Set(Array.from({ length: 200 }, () => generateResidentLinkToken()));
    expect(tokens.size).toBe(200); // 충돌 0 — 순차·시간 기반이 아니다
    for (const t of tokens) {
      expect(t).toHaveLength(43); // 32바이트 base64url
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe(경로 세그먼트로 그대로 쓴다)
    }
  });

  it('해시는 sha256 hex 결정적 — 같은 원문은 같은 해시(UNIQUE 인덱스 조회 가능)', () => {
    const token = generateResidentLinkToken();
    const expected = createHash('sha256').update(token, 'utf8').digest('hex');
    expect(hashResidentLinkToken(token)).toBe(expected);
    expect(hashResidentLinkToken(token)).toBe(hashResidentLinkToken(token));
    expect(hashResidentLinkToken(token)).toHaveLength(64);
  });

  it('★ 해시에서 원문이 드러나지 않는다 — 다른 토큰은 다른 해시', () => {
    const a = generateResidentLinkToken();
    const b = generateResidentLinkToken();
    expect(hashResidentLinkToken(a)).not.toBe(hashResidentLinkToken(b));
    expect(hashResidentLinkToken(a)).not.toContain(a);
  });

  it('형식 검사 — DB 조회 전 쓰레기 차단', () => {
    expect(isResidentLinkTokenShape(generateResidentLinkToken())).toBe(true);
    expect(isResidentLinkTokenShape('')).toBe(false);
    expect(isResidentLinkTokenShape('short')).toBe(false);
    expect(isResidentLinkTokenShape('a'.repeat(65))).toBe(false);
    expect(isResidentLinkTokenShape(`${'a'.repeat(42)}/+`)).toBe(false); // base64url 아님
    expect(isResidentLinkTokenShape(`${'a'.repeat(42)}.`)).toBe(false); // 경로 조작 문자
  });
});
