import {
  RECOMMENDATION_JOB_NAME,
  RECOMMENDATION_QUEUE_NAME,
  recommendationJobId,
} from './recommendation-job';

describe('recommendation-job — 큐 wire', () => {
  const id = '01920000-0000-7000-8000-0000000000a1';

  it('결정적 jobId — (추천행, 세대) 단위', () => {
    expect(recommendationJobId(id, 1)).toBe(`recommendation:${id}:g1`);
    expect(recommendationJobId(id, 2)).toBe(`recommendation:${id}:g2`);
    expect(recommendationJobId(id, 1)).toBe(recommendationJobId(id, 1)); // 멱등 재큐
  });

  it('★ BullMQ 제약: 콜론 정확히 2개(3파트)', () => {
    expect(recommendationJobId(id, 3).split(':')).toHaveLength(3);
  });

  it('큐 이름·잡 이름은 shared JobType과 정합', () => {
    expect(RECOMMENDATION_QUEUE_NAME).toBe('recommendation');
    expect(RECOMMENDATION_JOB_NAME).toBe('recommendation');
  });
});
