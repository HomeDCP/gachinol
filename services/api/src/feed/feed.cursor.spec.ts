import { decodeFeedCursor, encodeFeedCursor } from './feed.cursor';

describe('feed.cursor', () => {
  it('encode→decode 왕복', () => {
    const publishedAt = '2026-07-20T09:00:00.000Z';
    const id = '01920000-0000-7000-8000-0000000000a1';
    const decoded = decodeFeedCursor(encodeFeedCursor(publishedAt, id));
    expect(decoded).toEqual({ publishedAt, id });
  });

  it('opaque base64url — 원문 노출 안 함', () => {
    const raw = encodeFeedCursor('2026-07-20T09:00:00.000Z', 'abc');
    expect(raw).not.toContain('|');
    expect(raw).not.toContain('2026');
  });

  it('손상 커서 → null (fail-closed)', () => {
    expect(decodeFeedCursor('not-base64!!!@@@')).toBeNull();
    expect(decodeFeedCursor('')).toBeNull();
    // 구분자 없는 base64
    expect(decodeFeedCursor(Buffer.from('nodelimiter', 'utf8').toString('base64url'))).toBeNull();
    // publishedAt 비어있음
    expect(decodeFeedCursor(Buffer.from('|someid', 'utf8').toString('base64url'))).toBeNull();
    // id 비어있음
    expect(
      decodeFeedCursor(Buffer.from('2026-07-20T09:00:00.000Z|', 'utf8').toString('base64url')),
    ).toBeNull();
    // publishedAt이 유효 시각이 아님
    expect(
      decodeFeedCursor(Buffer.from('not-a-date|someid', 'utf8').toString('base64url')),
    ).toBeNull();
  });

  it('id에 UUID(하이픈 포함)가 있어도 첫 구분자 기준 분리', () => {
    const publishedAt = '2026-07-20T09:00:00.000Z';
    const id = '01920000-0000-7000-8000-0000000000a1';
    expect(decodeFeedCursor(encodeFeedCursor(publishedAt, id))?.id).toBe(id);
  });
});
