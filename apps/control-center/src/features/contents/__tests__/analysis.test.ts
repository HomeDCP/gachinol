import { toId } from '@gachinol/shared';
import type { AiAnalysis, AiAnalysisId, ContentId } from '@gachinol/shared';
import {
  formatRecommendationScore,
  hasSafetyFlags,
  hasText,
  hasVision,
  isStaleAnalysis,
} from '../analysis';
import { formatConfidence, formatSec } from '../format';

const baseAnalysis = (patch: Partial<AiAnalysis>): AiAnalysis => ({
  id: toId<AiAnalysisId>('an-1'),
  contentId: toId<ContentId>('c-1'),
  generation: 1,
  createdAt: '2026-07-01T00:00:00.000Z',
  ...patch,
});

describe('hasVision / hasText — 부분 부재', () => {
  test('vision만 있으면 hasVision true, hasText false', () => {
    const a = baseAnalysis({ vision: { shots: [], labels: [] } });
    expect(hasVision(a)).toBe(true);
    expect(hasText(a)).toBe(false);
  });

  test('text만 있으면 hasText true, hasVision false', () => {
    const a = baseAnalysis({ text: { transcript: [], summary: '요약', keywords: [], tags: [] } });
    expect(hasText(a)).toBe(true);
    expect(hasVision(a)).toBe(false);
  });

  test('undefined 분석은 둘 다 false', () => {
    expect(hasVision(undefined)).toBe(false);
    expect(hasText(undefined)).toBe(false);
  });
});

describe('isStaleAnalysis — generation 불일치', () => {
  test('분석 generation ≠ 콘텐츠 generation → stale', () => {
    expect(isStaleAnalysis(baseAnalysis({ generation: 1 }), 2)).toBe(true);
    expect(isStaleAnalysis(baseAnalysis({ generation: 2 }), 2)).toBe(false);
    expect(isStaleAnalysis(undefined, 2)).toBe(false);
  });
});

describe('hasSafetyFlags — 비어있음/존재 분기', () => {
  test('safetyFlags 있으면 true', () => {
    const a = baseAnalysis({ vision: { shots: [], labels: [], safetyFlags: ['violence'] } });
    expect(hasSafetyFlags(a)).toBe(true);
  });
  test('safetyFlags 없거나 비어있으면 false', () => {
    expect(hasSafetyFlags(baseAnalysis({ vision: { shots: [], labels: [] } }))).toBe(false);
    expect(
      hasSafetyFlags(baseAnalysis({ vision: { shots: [], labels: [], safetyFlags: [] } })),
    ).toBe(false);
    expect(hasSafetyFlags(undefined)).toBe(false);
  });
});

describe('formatRecommendationScore', () => {
  test('0~1 → NN%', () => {
    expect(formatRecommendationScore(0.5)).toBe('50%');
    expect(formatRecommendationScore(0)).toBe('0%');
    expect(formatRecommendationScore(1)).toBe('100%');
  });
  test('부재·비수치 → null', () => {
    expect(formatRecommendationScore(undefined)).toBeNull();
    expect(formatRecommendationScore(NaN)).toBeNull();
  });
});

describe('formatSec / formatConfidence', () => {
  test('formatSec — m:ss, 음수·NaN 방어', () => {
    expect(formatSec(0)).toBe('0:00');
    expect(formatSec(75)).toBe('1:15');
    expect(formatSec(-5)).toBe('0:00');
    expect(formatSec(NaN)).toBe('0:00');
  });
  test('formatConfidence — NN% / 부재 null', () => {
    expect(formatConfidence(0.92)).toBe('92%');
    expect(formatConfidence(undefined)).toBeNull();
  });
});
