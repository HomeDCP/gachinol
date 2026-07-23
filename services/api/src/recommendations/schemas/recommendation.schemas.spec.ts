import {
  zGenerateRecommendation,
  zRecommendationItems,
  zRecommendationListQuery,
  zRequestRecommendationRevision,
} from './recommendation.schemas';

const C1 = '01920000-0000-7000-8000-0000000000a1';
const C2 = '01920000-0000-7000-8000-0000000000a2';
const item = (rank: number, contentId: string) => ({ contentId, rank, reason: 'r' });

describe('zGenerateRecommendation', () => {
  it('YYYY-MM-DD만 허용 (정규화는 서비스가)', () => {
    expect(zGenerateRecommendation.parse({ weekOf: '2026-06-03' }).weekOf).toBe('2026-06-03');
    expect(zGenerateRecommendation.safeParse({ weekOf: '2026-6-3' }).success).toBe(false);
    expect(zGenerateRecommendation.safeParse({ weekOf: '2026-06-03T00:00:00Z' }).success).toBe(
      false,
    );
    expect(zGenerateRecommendation.safeParse({}).success).toBe(false);
  });

  it('★ 형식만 맞고 실존하지 않는 날짜는 거부 — 서비스 파서의 생 Error(500) 도달 차단', () => {
    for (const weekOf of ['2026-02-31', '2026-13-45', '2026-00-00', '2026-04-31', '2025-02-29']) {
      expect(zGenerateRecommendation.safeParse({ weekOf }).success).toBe(false);
    }
    expect(zGenerateRecommendation.safeParse({ weekOf: '2024-02-29' }).success).toBe(true); // 윤년
  });
});

describe('zRequestRecommendationRevision', () => {
  it('note는 필수·1~2000자', () => {
    expect(zRequestRecommendationRevision.safeParse({ note: '' }).success).toBe(false);
    expect(zRequestRecommendationRevision.safeParse({ note: '가'.repeat(2001) }).success).toBe(
      false,
    );
    expect(zRequestRecommendationRevision.parse({ note: '수정해줘' }).note).toBe('수정해줘');
  });
});

describe('zRecommendationItems — items JSONB 경계 재검증', () => {
  it('rank 1부터 연속이면 통과', () => {
    expect(zRecommendationItems.parse([item(1, C1), item(2, C2)])).toHaveLength(2);
    expect(zRecommendationItems.parse([])).toEqual([]);
  });

  it('rank가 0부터거나 건너뛰면 거부', () => {
    expect(zRecommendationItems.safeParse([item(0, C1)]).success).toBe(false);
    expect(zRecommendationItems.safeParse([item(1, C1), item(3, C2)]).success).toBe(false);
  });

  it('rank 중복 거부', () => {
    expect(zRecommendationItems.safeParse([item(1, C1), item(1, C2)]).success).toBe(false);
  });

  it('contentId 중복 거부', () => {
    expect(zRecommendationItems.safeParse([item(1, C1), item(2, C1)]).success).toBe(false);
  });

  it('score는 0~1 optional', () => {
    expect(zRecommendationItems.safeParse([{ ...item(1, C1), score: 1.5 }]).success).toBe(false);
    expect(zRecommendationItems.safeParse([{ ...item(1, C1), score: 0.5 }]).success).toBe(true);
  });
});

describe('zRecommendationListQuery', () => {
  it('zPage clamp 재사용 + status 필터', () => {
    expect(zRecommendationListQuery.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(zRecommendationListQuery.parse({ pageSize: '500' }).pageSize).toBe(100);
    expect(zRecommendationListQuery.parse({ status: 'pending_review' }).status).toBe(
      'pending_review',
    );
    expect(zRecommendationListQuery.safeParse({ status: 'nope' }).success).toBe(false);
  });
});
