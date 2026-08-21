import type { ChannelAccountId } from '@gachinol/shared';
import {
  emptyProductCardDraft,
  validateCreateLiveSession,
  TITLE_MAX_LEN,
  type ProductCardDraft,
} from '../validation';

const NO_CHANNELS: ChannelAccountId[] = [];

describe('validateCreateLiveSession', () => {
  test('정규 편성: 유효한 scheduledAt → ok + request 구성', () => {
    const r = validateCreateLiveSession({
      type: 'news',
      title: '  주간뉴스  ',
      scheduledAt: '2026-07-25T20:00:00.000Z',
      targetChannelAccountIds: NO_CHANNELS,
    });
    expect(r.ok).toBe(true);
    expect(r.request).toEqual({
      type: 'news',
      title: '주간뉴스', // trim 반영
      scheduledAt: '2026-07-25T20:00:00.000Z',
      targetChannelAccountIds: [],
    });
  });

  test('불변식: 긴급 + scheduledAt 지정 → scheduledAt 에러', () => {
    const r = validateCreateLiveSession({
      type: 'emergency',
      title: '긴급 재난 방송',
      scheduledAt: '2026-07-25T20:00:00.000Z',
      targetChannelAccountIds: NO_CHANNELS,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.scheduledAt).toBeDefined();
  });

  test('긴급 + scheduledAt=null → ok, request.scheduledAt=null', () => {
    const r = validateCreateLiveSession({
      type: 'emergency',
      title: '긴급 재난 방송',
      scheduledAt: null,
      targetChannelAccountIds: NO_CHANNELS,
    });
    expect(r.ok).toBe(true);
    expect(r.request?.scheduledAt).toBeNull();
  });

  test('정규 편성 + scheduledAt=null → 편성 시각 에러', () => {
    const r = validateCreateLiveSession({
      type: 'news',
      title: '주간뉴스',
      scheduledAt: null,
      targetChannelAccountIds: NO_CHANNELS,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.scheduledAt).toBeDefined();
  });

  test('정규 편성 + 잘못된 날짜 형식 → 형식 에러', () => {
    const r = validateCreateLiveSession({
      type: 'news',
      title: '주간뉴스',
      scheduledAt: 'not-a-date',
      targetChannelAccountIds: NO_CHANNELS,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.scheduledAt).toBeDefined();
  });

  test('빈 제목 → title 에러, 초과 길이 → title 에러', () => {
    expect(
      validateCreateLiveSession({
        type: 'emergency',
        title: '   ',
        scheduledAt: null,
        targetChannelAccountIds: NO_CHANNELS,
      }).errors.title,
    ).toBeDefined();
    expect(
      validateCreateLiveSession({
        type: 'emergency',
        title: 'x'.repeat(TITLE_MAX_LEN + 1),
        scheduledAt: null,
        targetChannelAccountIds: NO_CHANNELS,
      }).errors.title,
    ).toBeDefined();
  });

  describe('라이브커머스 상품 카드 (T-W2-11, 1단계 링크아웃)', () => {
    const commerce = (cards: ProductCardDraft[]) =>
      validateCreateLiveSession({
        type: 'live_commerce',
        title: '애월 한라봉 라이브',
        scheduledAt: '2026-08-29T11:00:00.000Z',
        targetChannelAccountIds: NO_CHANNELS,
        productCards: cards,
      });

    const draft = (over: Partial<ProductCardDraft> = {}): ProductCardDraft => ({
      ...emptyProductCardDraft(),
      name: '한라봉 5kg',
      url: 'https://smartstore.naver.com/x/1',
      ...over,
    });

    it('정상 카드를 요청에 싣고 선택 필드의 빈 값은 생략한다', () => {
      const result = commerce([draft({ priceLabel: '25,000원' })]);

      expect(result.ok).toBe(true);
      expect(result.request?.productCards).toEqual([
        { name: '한라봉 5kg', url: 'https://smartstore.naver.com/x/1', priceLabel: '25,000원' },
      ]);
      // imageUrl은 빈 문자열이었으므로 키 자체가 없다(서버 zod의 optional과 일치)
      expect(result.request?.productCards?.[0]).not.toHaveProperty('imageUrl');
    });

    it('전부 빈 행은 오류가 아니라 무시된다 — [상품 추가]만 누른 상태로 제출 가능', () => {
      const result = commerce([emptyProductCardDraft(), draft()]);

      expect(result.ok).toBe(true);
      expect(result.request?.productCards).toHaveLength(1);
    });

    it('카드가 하나도 없으면 productCards 키를 보내지 않는다', () => {
      const result = commerce([]);

      expect(result.ok).toBe(true);
      expect(result.request).not.toHaveProperty('productCards');
    });

    it('http(s)가 아닌 판매 링크는 해당 행을 지목해 거부한다', () => {
      for (const url of ['javascript:alert(1)', 'smartstore.naver.com/x', '']) {
        const result = commerce([draft({ url })]);
        expect(result.ok).toBe(false);
        expect(result.errors.productCards?.[0]).toBeDefined();
      }
    });

    it('상품명이 비면 거부한다(링크만 있는 카드는 화면에 이름 없이 뜬다)', () => {
      const result = commerce([draft({ name: '' })]);

      expect(result.ok).toBe(false);
      expect(result.errors.productCards?.[0]).toContain('상품명');
    });

    it('부적격 이미지 주소도 행 단위로 거부한다', () => {
      const result = commerce([draft({ imageUrl: 'javascript:void(0)' })]);

      expect(result.ok).toBe(false);
      expect(result.errors.productCards?.[0]).toContain('이미지');
    });

    it('오류 행과 정상 행이 섞이면 제출을 막는다 — 일부만 저장되면 관제가 알아채기 어렵다', () => {
      const result = commerce([draft(), draft({ url: 'javascript:alert(1)' })]);

      expect(result.ok).toBe(false);
      expect(result.request).toBeUndefined();
      expect(result.errors.productCards?.[1]).toBeDefined();
    });
  });
});
