import { buildReason, buildWeeklySummary } from './reason';

describe('reason — 추천 근거 3분기', () => {
  it('① summary 있음: 첫 문장 + 키워드(최대 3)', () => {
    const out = buildReason({
      summary: '애월 해녀들의 물질 현장을 동행 취재했다. 두 번째 문장은 버린다.',
      keywords: ['해녀', '애월', '물질', '버려질키워드'],
      score: 0.9,
      rank: 1,
    });
    expect(out).toBe('애월 해녀들의 물질 현장을 동행 취재했다. · 키워드: 해녀·애월·물질');
    expect(out).not.toContain('두 번째 문장');
    expect(out).not.toContain('버려질키워드');
  });

  it('① 첫 문장이 80자를 넘으면 절단', () => {
    const out = buildReason({ summary: '가'.repeat(200), score: 0.5, rank: 2 });
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('…')).toBe(true);
  });

  it('② summary 없고 keywords만', () => {
    expect(buildReason({ keywords: ['날씨', '촌장'], score: 0.4, rank: 3 })).toBe(
      '키워드: 날씨·촌장',
    );
  });

  it('③ 둘 다 없으면 점수·순위 근거로 퇴화 (날조 금지)', () => {
    expect(buildReason({ score: 0.42, rank: 5 })).toBe(
      'AI 요약 없음 — 추천 점수 0.42 기준 상위 5위',
    );
    expect(buildReason({ summary: '   ', keywords: [], score: 0, rank: 7 })).toBe(
      'AI 요약 없음 — 추천 점수 0.00 기준 상위 7위',
    );
  });

  it('결정적 — 같은 입력이면 같은 문자열', () => {
    const input = { summary: '요약이다.', keywords: ['a'], score: 0.1, rank: 1 };
    expect(buildReason(input)).toBe(buildReason(input));
  });
});

describe('reason — 주간 총평', () => {
  it('후보수·선정수·분류 분포', () => {
    expect(
      buildWeeklySummary({
        weekOf: '2026-06-01',
        candidateCount: 9,
        selectedCount: 3,
        categoryCounts: { news: 2, culture: 1 },
        generation: 1,
      }),
    ).toBe('2026-06-01 주간 — 후보 9건 중 3건 선정 · 분류 culture 1 · news 2');
  });

  it('재생성(g≥2)은 수정 지시를 접두 — RecommendationReview에 이력 필드가 없는 계약 제약을 메운다', () => {
    const out = buildWeeklySummary({
      weekOf: '2026-06-01',
      candidateCount: 4,
      selectedCount: 2,
      categoryCounts: { news: 2 },
      generation: 2,
      revisionNote: '날씨 꼭지를 앞으로',
    });
    expect(out.startsWith('[재생성 g2 — 수정 지시: 날씨 꼭지를 앞으로]')).toBe(true);
  });

  it('g1은 수정 지시가 있어도 접두하지 않는다', () => {
    const out = buildWeeklySummary({
      weekOf: '2026-06-01',
      candidateCount: 1,
      selectedCount: 1,
      categoryCounts: {},
      generation: 1,
      revisionNote: '무시된다',
    });
    expect(out).toBe('2026-06-01 주간 — 후보 1건 중 1건 선정');
  });
});
