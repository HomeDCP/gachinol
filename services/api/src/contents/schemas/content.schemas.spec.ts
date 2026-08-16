import { MinorConsentFilter } from '@gachinol/shared';
import { zPage } from '../../common/zod';
import { zContentListQuery, zCreateContentDraft, zUpdateContentDraft } from './content.schemas';

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

  describe('remakeOfContentId — 선택 필드(T-W2-20)', () => {
    it('미지정이면 undefined로 성공 (기존 경로 무영향)', () => {
      const res = zCreateContentDraft.safeParse(base);
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.remakeOfContentId).toBeUndefined();
    });

    it('유효한 UUID면 성공', () => {
      const res = zCreateContentDraft.safeParse({
        ...base,
        remakeOfContentId: '018f4b2a-0000-7000-8000-000000000001',
      });
      expect(res.success).toBe(true);
    });

    it('UUID 형식이 아니면 실패', () => {
      const res = zCreateContentDraft.safeParse({ ...base, remakeOfContentId: 'not-a-uuid' });
      expect(res.success).toBe(false);
    });
  });

  describe('hasMinorSubject — 선택 필드(T-W2-23)', () => {
    it('zCreateContentDraft: 미지정이면 undefined로 성공 (미전송 시 서버가 false로 저장)', () => {
      const res = zCreateContentDraft.safeParse(base);
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.hasMinorSubject).toBeUndefined();
    });

    it('zCreateContentDraft: boolean 전송 시 그대로 성공', () => {
      const res = zCreateContentDraft.safeParse({ ...base, hasMinorSubject: true });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.hasMinorSubject).toBe(true);
    });

    it('zCreateContentDraft: boolean이 아니면 실패', () => {
      const res = zCreateContentDraft.safeParse({ ...base, hasMinorSubject: 'yes' });
      expect(res.success).toBe(false);
    });

    it('zUpdateContentDraft: hasMinorSubject만 단독 전송해도 성공', () => {
      const res = zUpdateContentDraft.safeParse({ hasMinorSubject: false });
      expect(res.success).toBe(true);
    });
  });

  describe('zContentListQuery.minorConsent — 게이트 필터 (T-W2-27, 대장 #118)', () => {
    it('미지정이면 undefined (기존 목록 호출 무회귀)', () => {
      const res = zContentListQuery.safeParse({});
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.minorConsent).toBeUndefined();
    });

    it.each(Object.values(MinorConsentFilter))('shared 열거값 %s를 받는다', (value) => {
      const res = zContentListQuery.safeParse({ minorConsent: value });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.minorConsent).toBe(value);
    });

    it('열거값 밖은 거부 (400 validation_failed)', () => {
      expect(zContentListQuery.safeParse({ minorConsent: 'unknown' }).success).toBe(false);
      expect(zContentListQuery.safeParse({ minorConsent: true }).success).toBe(false);
    });

    it('status와 동시 지정 가능 — 직교 축이다', () => {
      const res = zContentListQuery.safeParse({
        minorConsent: 'pending',
        status: 'awaiting_reporter_review',
      });
      expect(res.success).toBe(true);
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
