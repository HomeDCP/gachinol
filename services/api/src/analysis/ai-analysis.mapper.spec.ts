import type { AiAnalysis as AiAnalysisRow } from '@prisma/client';
import { toAiAnalysis } from './ai-analysis.mapper';

const row = (over: Partial<AiAnalysisRow> = {}): AiAnalysisRow => ({
  id: 'a-1',
  contentId: 'c-1',
  generation: 1,
  vision: { shots: [{ startSec: 0, endSec: 5 }], labels: ['바다'] } as never,
  text: { transcript: [], summary: '요약', keywords: ['해녀'], tags: ['바다'] } as never,
  recommendationScore: 0.42,
  modelInfo: { visionModel: 'stub-vision', sttModel: 'stub-stt', version: '0.1.0' } as never,
  createdByJobId: 'analysis:c-1:g1',
  createdAt: new Date('2026-07-22T00:00:00.000Z'),
  completedAt: new Date('2026-07-22T00:00:05.000Z'),
  ...over,
});

describe('toAiAnalysis', () => {
  it('JSONB 캐스팅·ISO 시각·brand id', () => {
    const a = toAiAnalysis(row());
    expect(a.id).toBe('a-1');
    expect(a.contentId).toBe('c-1');
    expect(a.generation).toBe(1);
    expect(a.vision?.labels).toEqual(['바다']);
    expect(a.text?.summary).toBe('요약');
    expect(a.recommendationScore).toBe(0.42);
    expect(a.modelInfo?.version).toBe('0.1.0');
    expect(a.createdAt).toBe('2026-07-22T00:00:00.000Z');
    expect(a.completedAt).toBe('2026-07-22T00:00:05.000Z');
  });

  it('null 필드 → undefined (부분 분석·미완료)', () => {
    const a = toAiAnalysis(
      row({ vision: null, recommendationScore: null, modelInfo: null, completedAt: null }),
    );
    expect(a.vision).toBeUndefined();
    expect(a.recommendationScore).toBeUndefined();
    expect(a.modelInfo).toBeUndefined();
    expect(a.completedAt).toBeUndefined();
    expect(a.text).toBeDefined();
  });
});
