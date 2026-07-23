import { v7 as uuidv7 } from 'uuid';
import { zCreateLiveSession, zLiveSessionListQuery } from './live.schemas';

describe('live.schemas', () => {
  describe('zCreateLiveSession', () => {
    it('정규 편성 — scheduledAt 지정 통과', () => {
      const parsed = zCreateLiveSession.parse({
        type: 'news',
        title: '주간뉴스',
        scheduledAt: '2026-07-25T10:00:00.000Z',
        targetChannelAccountIds: [uuidv7()],
      });
      expect(parsed.type).toBe('news');
      expect(parsed.targetChannelAccountIds).toHaveLength(1);
    });

    it('긴급 — scheduledAt=null 통과(불변식 최종검증은 서비스)', () => {
      const parsed = zCreateLiveSession.parse({
        type: 'emergency',
        title: '긴급',
        scheduledAt: null,
        targetChannelAccountIds: [],
      });
      expect(parsed.scheduledAt).toBeNull();
      expect(parsed.targetChannelAccountIds).toEqual([]);
    });

    it('잘못된 type 거부', () => {
      expect(() =>
        zCreateLiveSession.parse({ type: 'nope', title: 't', scheduledAt: null, targetChannelAccountIds: [] }),
      ).toThrow();
    });

    it('빈 title 거부', () => {
      expect(() =>
        zCreateLiveSession.parse({ type: 'news', title: '', scheduledAt: null, targetChannelAccountIds: [] }),
      ).toThrow();
    });
  });

  describe('zLiveSessionListQuery', () => {
    it('pageSize 100 초과는 clamp(절삭)', () => {
      const q = zLiveSessionListQuery.parse({ pageSize: '999' });
      expect(q.pageSize).toBe(100);
      expect(q.page).toBe(1);
    });

    it('status 필터 파싱', () => {
      const q = zLiveSessionListQuery.parse({ status: 'live' });
      expect(q.status).toBe('live');
    });
  });
});
