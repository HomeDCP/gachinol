import { PUBLICATION_STATUS_TRANSITIONS, type PublicationStatus } from '@gachinol/shared';
import { canTransitionPublication } from './publication-status';

/** 규칙 사본 없음 증명 — 헬퍼가 shared 맵과 완전 일치 */
describe('canTransitionPublication', () => {
  const all = Object.keys(PUBLICATION_STATUS_TRANSITIONS) as PublicationStatus[];

  it('shared PUBLICATION_STATUS_TRANSITIONS와 모든 (from,to) 쌍에서 일치', () => {
    for (const from of all) {
      for (const to of all) {
        const allowed = (PUBLICATION_STATUS_TRANSITIONS[from] as readonly string[]).includes(to);
        expect(canTransitionPublication(from, to)).toBe(allowed);
      }
    }
  });

  it('대표 합법/불법 전이', () => {
    expect(canTransitionPublication('queued', 'publishing')).toBe(true);
    expect(canTransitionPublication('publishing', 'published')).toBe(true);
    expect(canTransitionPublication('publishing', 'failed')).toBe(true);
    expect(canTransitionPublication('failed', 'queued')).toBe(true);
    expect(canTransitionPublication('published', 'retracted')).toBe(true);
    // 불법
    expect(canTransitionPublication('queued', 'failed')).toBe(false);
    expect(canTransitionPublication('published', 'queued')).toBe(false);
    expect(canTransitionPublication('retracted', 'published')).toBe(false);
  });
});
