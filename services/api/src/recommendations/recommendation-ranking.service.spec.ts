import { makePrismaMock } from '../test-support/fixtures';
import {
  categoryCounts,
  rankCandidates,
  RecommendationRankingService,
  sortCandidates,
  type RankCandidate,
} from './recommendation-ranking.service';

const C = (n: number) => `01920000-0000-7000-8000-00000000000${n}`;

const cand = (over: Partial<RankCandidate> & { contentId: string }): RankCandidate => ({
  category: 'news',
  publishedAt: new Date('2026-06-02T09:00:00.000Z'),
  score: 0.5,
  ...over,
});

describe('rankCandidates — 결정적 전순서 랭킹', () => {
  it('score DESC → publishedAt DESC → contentId ASC', () => {
    const items = rankCandidates(
      [
        cand({ contentId: C(3), score: 0.7, publishedAt: new Date('2026-06-02T00:00:00Z') }),
        cand({ contentId: C(1), score: 0.9 }),
        cand({ contentId: C(2), score: 0.7, publishedAt: new Date('2026-06-04T00:00:00Z') }),
      ],
      10,
    );
    expect(items.map((i) => i.contentId)).toEqual([C(1), C(2), C(3)]);
    expect(items.map((i) => i.rank)).toEqual([1, 2, 3]);
  });

  it('score·publishedAt 동점은 contentId ASC로 확정 (흔들림 0)', () => {
    const at = new Date('2026-06-02T00:00:00Z');
    const a = cand({ contentId: C(5), score: 0.5, publishedAt: at });
    const b = cand({ contentId: C(4), score: 0.5, publishedAt: at });
    expect(sortCandidates([a, b]).map((c) => c.contentId)).toEqual([C(4), C(5)]);
    expect(sortCandidates([b, a]).map((c) => c.contentId)).toEqual([C(4), C(5)]);
  });

  it('score null은 0으로 정규화 — 최하위로 밀린다', () => {
    const items = rankCandidates(
      [cand({ contentId: C(1), score: null }), cand({ contentId: C(2), score: 0.01 })],
      10,
    );
    expect(items[0]!.contentId).toBe(C(2));
    // score는 optional — null을 0으로 날조하지 않는다
    expect(items[1]!.score).toBeUndefined();
    expect(items[0]!.score).toBe(0.01);
  });

  it('상위 N 절단 + rank 1부터 재부여', () => {
    const items = rankCandidates(
      [1, 2, 3, 4, 5].map((n) => cand({ contentId: C(n), score: 1 - n / 10 })),
      3,
    );
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.rank)).toEqual([1, 2, 3]);
  });

  it('후보 0건은 실패가 아니라 빈 배열 (판정은 기록자의 몫)', () => {
    expect(rankCandidates([], 7)).toEqual([]);
  });

  it('reason은 분석 텍스트에서 파생 — highlights는 채우지 않는다(샷 경계≠하이라이트)', () => {
    const [item] = rankCandidates(
      [cand({ contentId: C(1), summary: '요약 문장이다.', keywords: ['k1'] })],
      1,
    );
    expect(item!.reason).toBe('요약 문장이다. · 키워드: k1');
    expect(item!.highlights).toBeUndefined();
  });

  it('categoryCounts — 선정분의 분류 분포', () => {
    const cands = [
      cand({ contentId: C(1), category: 'news', score: 0.9 }),
      cand({ contentId: C(2), category: 'news', score: 0.8 }),
      cand({ contentId: C(3), category: 'culture', score: 0.7 }),
    ];
    const items = rankCandidates(cands, 3);
    expect(categoryCounts(items, new Map(cands.map((c) => [c.contentId, c])))).toEqual({
      news: 2,
      culture: 1,
    });
  });
});

describe('RecommendationRankingService.rank — 후보 수집(read-only)', () => {
  const setup = (topN = 7) => {
    const prisma = makePrismaMock();
    const config = { get: jest.fn().mockReturnValue(topN) };
    return { prisma, service: new RecommendationRankingService(prisma, config as never) };
  };

  it('published + 주차 윈도우 + 같은 세대 완료분석만 후보', async () => {
    const { prisma, service } = setup();
    prisma.content.findMany.mockResolvedValue([
      { id: C(1), generation: 1, category: 'news', publishedAt: new Date('2026-06-02T00:00:00Z') },
      { id: C(2), generation: 2, category: 'news', publishedAt: new Date('2026-06-03T00:00:00Z') }, // 분석 세대 불일치
      { id: C(3), generation: 1, category: 'news', publishedAt: new Date('2026-06-04T00:00:00Z') }, // 분석 없음
    ]);
    prisma.aiAnalysis.findMany.mockResolvedValue([
      { contentId: C(1), generation: 1, recommendationScore: 0.9, text: { summary: '요약.' } },
      { contentId: C(2), generation: 1, recommendationScore: 0.95, text: null }, // 구세대 분석
    ]);

    const out = await service.rank({ weekOf: '2026-06-01' });
    expect(out.candidateCount).toBe(1);
    expect(out.items.map((i) => i.contentId)).toEqual([C(1)]);

    const where = prisma.content.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('published');
    expect(where.publishedAt.gte.toISOString()).toBe('2026-05-31T15:00:00.000Z');
    expect(where.publishedAt.lt.toISOString()).toBe('2026-06-07T15:00:00.000Z');
    // ★ read-only — 어떤 쓰기도 하지 않는다
    expect(prisma.weeklyRecommendation.updateMany).not.toHaveBeenCalled();
    expect(prisma.statusTransitionLog.create).not.toHaveBeenCalled();
  });

  it('excludeContentIds는 where notIn으로 배선(v1 호출측은 항상 [])', async () => {
    const { prisma, service } = setup();
    prisma.content.findMany.mockResolvedValue([]);
    await service.rank({ weekOf: '2026-06-01', excludeContentIds: [C(9)] });
    expect(prisma.content.findMany.mock.calls[0][0].where.id).toEqual({ notIn: [C(9)] });
  });

  it('콘텐츠 0건이면 분석 조회조차 하지 않고 빈 결과', async () => {
    const { prisma, service } = setup();
    prisma.content.findMany.mockResolvedValue([]);
    const out = await service.rank({ weekOf: '2026-06-01' });
    expect(out.candidateCount).toBe(0);
    expect(out.items).toEqual([]);
    expect(prisma.aiAnalysis.findMany).not.toHaveBeenCalled();
    expect(out.summary).toContain('후보 0건 중 0건 선정');
  });

  it('topN은 env 기본값(7)을 따르고 파라미터가 우선', async () => {
    const { prisma, service } = setup(2);
    prisma.content.findMany.mockResolvedValue(
      [1, 2, 3].map((n) => ({
        id: C(n),
        generation: 1,
        category: 'news',
        publishedAt: new Date('2026-06-02T00:00:00Z'),
      })),
    );
    prisma.aiAnalysis.findMany.mockResolvedValue(
      [1, 2, 3].map((n) => ({
        contentId: C(n),
        generation: 1,
        recommendationScore: 1 - n / 10,
        text: null,
      })),
    );
    expect((await service.rank({ weekOf: '2026-06-01' })).items).toHaveLength(2);
    expect((await service.rank({ weekOf: '2026-06-01', topN: 1 })).items).toHaveLength(1);
  });
});
