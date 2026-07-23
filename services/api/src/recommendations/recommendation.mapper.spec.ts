import { recommendationRow } from '../test-support/fixtures';
import { toWeeklyRecommendation } from './recommendation.mapper';

const item = (rank: number, contentId: string) => ({
  contentId,
  rank,
  score: 0.5,
  reason: '근거',
});

const C1 = '01920000-0000-7000-8000-0000000000a1';
const C2 = '01920000-0000-7000-8000-0000000000a2';

describe('toWeeklyRecommendation', () => {
  it('week_of는 UTC 기반 YYYY-MM-DD — 로컬 오프셋으로 하루 밀리지 않는다', () => {
    const out = toWeeklyRecommendation(
      recommendationRow({ weekOf: new Date('2026-06-01T00:00:00.000Z') }),
    );
    expect(out.weekOf).toBe('2026-06-01');
  });

  it('items JSONB는 읽기 경계에서 zod 재검증 후 투영', () => {
    const out = toWeeklyRecommendation(
      recommendationRow({ items: [item(1, C1), item(2, C2)] as never, summary: '총평' }),
    );
    expect(out.items).toHaveLength(2);
    expect(out.items[0]!.rank).toBe(1);
    expect(out.summary).toBe('총평');
  });

  it('rank가 1부터 연속이 아니면 데이터 불변식 위반으로 throw', () => {
    expect(() =>
      toWeeklyRecommendation(recommendationRow({ items: [item(2, C1)] as never })),
    ).toThrow();
  });

  it('null 필드는 계약대로 null / undefined 투영', () => {
    const out = toWeeklyRecommendation(recommendationRow());
    expect(out.summary).toBeUndefined();
    expect(out.generatedByJobId).toBeNull();
    expect(out.approvedByUserId).toBeNull();
    expect(out.approvedAt).toBeNull();
    expect(out.publishedAt).toBeNull();
  });

  it('승인 정보가 있으면 ISO 문자열로', () => {
    const out = toWeeklyRecommendation(
      recommendationRow({
        status: 'approved',
        approvedByUserId: 'u-center',
        approvedAt: new Date('2026-06-05T01:02:03.000Z'),
      }),
    );
    expect(out.status).toBe('approved');
    expect(out.approvedAt).toBe('2026-06-05T01:02:03.000Z');
  });
});
