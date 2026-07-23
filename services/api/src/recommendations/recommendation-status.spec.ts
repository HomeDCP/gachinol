import { RECOMMENDATION_STATUS_TRANSITIONS, RecommendationStatus } from '@gachinol/shared';
import { canTransitionRecommendation } from './recommendation-status';

describe('canTransitionRecommendation — shared 전이맵 위임(사본 없음)', () => {
  it('생성 루프 정상 경로', () => {
    expect(canTransitionRecommendation('generating', 'pending_review')).toBe(true);
    expect(canTransitionRecommendation('pending_review', 'approved')).toBe(true);
    expect(canTransitionRecommendation('pending_review', 'revision_requested')).toBe(true);
    expect(canTransitionRecommendation('revision_requested', 'regenerating')).toBe(true);
    expect(canTransitionRecommendation('regenerating', 'pending_review')).toBe(true);
  });

  it('실패·재시도 경로', () => {
    expect(canTransitionRecommendation('generating', 'generation_failed')).toBe(true);
    expect(canTransitionRecommendation('regenerating', 'generation_failed')).toBe(true);
    expect(canTransitionRecommendation('generation_failed', 'generating')).toBe(true);
  });

  it('종결 상태에서 나가는 전이는 없다', () => {
    expect(canTransitionRecommendation('published', 'publishing')).toBe(false);
    expect(canTransitionRecommendation('discarded', 'generating')).toBe(false);
  });

  it('approved에서 수정요청·재생성으로 되돌아갈 수 없다 (맵상 부재)', () => {
    expect(canTransitionRecommendation('approved', 'revision_requested')).toBe(false);
    expect(canTransitionRecommendation('approved', 'regenerating')).toBe(false);
    expect(canTransitionRecommendation('approved', 'publishing')).toBe(true); // 유일 전진(배선은 후속)
  });

  it('맵 전수 위임 — shared 맵과 판정이 100% 일치', () => {
    const all = Object.values(RecommendationStatus);
    for (const from of all) {
      for (const to of all) {
        const expected = (
          RECOMMENDATION_STATUS_TRANSITIONS[from] as readonly RecommendationStatus[]
        ).includes(to);
        expect(canTransitionRecommendation(from, to)).toBe(expected);
      }
    }
  });
});
