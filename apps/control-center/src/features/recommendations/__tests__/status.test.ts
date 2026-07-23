import { RecommendationStatus } from '@gachinol/shared';
import {
  RECOMMENDATION_BADGE,
  RECOMMENDATION_DESCRIPTION,
  isAutoProgressRecommendationStatus,
  recommendationActionsFor,
  recommendationBadge,
} from '../status';

const ALL = Object.values(RecommendationStatus);

describe('RECOMMENDATION_BADGE — 10종 전수', () => {
  test('상태 10종', () => {
    expect(ALL).toHaveLength(10);
  });

  test.each(ALL)('%s — 라벨·톤·설명 존재', (status) => {
    expect(recommendationBadge(status).label.length).toBeGreaterThan(0);
    expect(recommendationBadge(status).tone.length).toBeGreaterThan(0);
    expect(RECOMMENDATION_DESCRIPTION[status].length).toBeGreaterThan(0);
  });

  test('배지 맵 키가 shared 상태 10종과 정확히 일치', () => {
    expect(Object.keys(RECOMMENDATION_BADGE).sort()).toEqual([...ALL].sort());
  });

  test('needsCenterAction 정확히 2종 (pending_review · generation_failed)', () => {
    const flagged = ALL.filter((s) => recommendationBadge(s).needsCenterAction === true).sort();
    expect(flagged).toEqual(['generation_failed', 'pending_review']);
  });
});

describe('recommendationActionsFor', () => {
  test('pending_review → canDecide=true, canRetryGeneration=false', () => {
    expect(recommendationActionsFor({ status: 'pending_review' })).toEqual({
      canDecide: true,
      canRetryGeneration: false,
    });
  });

  test('generation_failed → canRetryGeneration=true, canDecide=false', () => {
    expect(recommendationActionsFor({ status: 'generation_failed' })).toEqual({
      canDecide: false,
      canRetryGeneration: true,
    });
  });

  test('전 상태 순회 — 진리표', () => {
    for (const status of ALL) {
      const a = recommendationActionsFor({ status });
      expect(a.canDecide).toBe(status === 'pending_review');
      expect(a.canRetryGeneration).toBe(status === 'generation_failed');
    }
  });

  test('approved·regenerating·discarded → 전부 false', () => {
    for (const status of ['approved', 'regenerating', 'discarded'] as const) {
      expect(recommendationActionsFor({ status })).toEqual({
        canDecide: false,
        canRetryGeneration: false,
      });
    }
  });
});

describe('isAutoProgressRecommendationStatus — 폴링 대상 2종', () => {
  test('generating·regenerating만 true', () => {
    for (const status of ALL) {
      expect(isAutoProgressRecommendationStatus(status)).toBe(
        status === 'generating' || status === 'regenerating',
      );
    }
  });
});
