import { zFeedQuery } from './feed.schemas';

describe('zFeedQuery', () => {
  it('기본값 — limit 20, cursor/필터 undefined', () => {
    const q = zFeedQuery.parse({});
    expect(q.limit).toBe(20);
    expect(q.cursor).toBeUndefined();
    expect(q.stationId).toBeUndefined();
    expect(q.category).toBeUndefined();
  });

  it('limit 문자열 coerce', () => {
    expect(zFeedQuery.parse({ limit: '5' }).limit).toBe(5);
  });

  it('limit clamp ≤ 100 (거부 아닌 절삭)', () => {
    expect(zFeedQuery.parse({ limit: '500' }).limit).toBe(100);
  });

  it('limit < 1 거부', () => {
    expect(() => zFeedQuery.parse({ limit: '0' })).toThrow();
  });

  it('잘못된 category 거부', () => {
    expect(() => zFeedQuery.parse({ category: 'not_a_category' })).toThrow();
  });

  it('유효 category·stationId 통과', () => {
    const q = zFeedQuery.parse({
      category: 'local_weather',
      stationId: '01920000-0000-7000-8000-000000000001',
    });
    expect(q.category).toBe('local_weather');
    expect(q.stationId).toBe('01920000-0000-7000-8000-000000000001');
  });

  it('stationId가 UUID 아니면 거부', () => {
    expect(() => zFeedQuery.parse({ stationId: 'nope' })).toThrow();
  });

  it('cursor 512자 초과 거부', () => {
    expect(() => zFeedQuery.parse({ cursor: 'x'.repeat(513) })).toThrow();
  });
});
