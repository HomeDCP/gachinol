import { zPage } from '../../common/zod';
import { zCreateContentDraft } from './content.schemas';

describe('content.schemas', () => {
  const base = {
    title: '테스트',
    category: 'news',
    scenes: [
      { order: 0, caption: '오프닝', startSec: null, endSec: null },
      { order: 1, caption: '본문', startSec: 0, endSec: 10 },
    ],
  };

  describe('culture↔cultureTopics 상호 불변식', () => {
    it('culture인데 cultureTopics 없음 → 실패', () => {
      const res = zCreateContentDraft.safeParse({ ...base, category: 'culture' });
      expect(res.success).toBe(false);
    });

    it('culture + cultureTopics → 성공', () => {
      const res = zCreateContentDraft.safeParse({
        ...base,
        category: 'culture',
        cultureTopics: ['food', 'festival'],
      });
      expect(res.success).toBe(true);
    });

    it('culture 외 분류에 cultureTopics → 실패', () => {
      const res = zCreateContentDraft.safeParse({ ...base, cultureTopics: ['food'] });
      expect(res.success).toBe(false);
    });
  });

  describe('scenes order 연속성', () => {
    it('0부터 연속이 아니면 실패 (0,2)', () => {
      const res = zCreateContentDraft.safeParse({
        ...base,
        scenes: [
          { order: 0, caption: 'a', startSec: null, endSec: null },
          { order: 2, caption: 'b', startSec: null, endSec: null },
        ],
      });
      expect(res.success).toBe(false);
    });

    it('중복 order 실패 (0,0)', () => {
      const res = zCreateContentDraft.safeParse({
        ...base,
        scenes: [
          { order: 0, caption: 'a', startSec: null, endSec: null },
          { order: 0, caption: 'b', startSec: null, endSec: null },
        ],
      });
      expect(res.success).toBe(false);
    });
  });

  describe('zPage — 기본값·clamp', () => {
    it('기본 page=1, pageSize=20', () => {
      expect(zPage.parse({})).toEqual({ page: 1, pageSize: 20 });
    });

    it('pageSize 최대 100 서버 clamp (거부가 아니라 절삭)', () => {
      expect(zPage.parse({ pageSize: '500' }).pageSize).toBe(100);
    });

    it('쿼리스트링 숫자 coerce', () => {
      expect(zPage.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
    });
  });
});
