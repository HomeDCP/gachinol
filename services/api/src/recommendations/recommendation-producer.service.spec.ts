import { RecommendationProducerService } from './recommendation-producer.service';
import type { RecommendationJobData } from './recommendation-job';

const data: RecommendationJobData = {
  recommendationId: 'wr-1',
  weekOf: '2026-06-01',
  generation: 2,
  revisionRequestId: 'rr-1',
  revisionNote: '날씨 꼭지를 앞으로',
  excludeContentIds: [],
};

const config = { get: jest.fn().mockReturnValue(3) } as never;

const ranking = () => ({
  rank: jest.fn().mockResolvedValue({ candidateCount: 4, items: [{ rank: 1 }], summary: '총평' }),
});

describe('RecommendationProducerService', () => {
  it('큐 활성: 결정적 jobId로 remove→add (재큐 멱등), 인라인 계산 안 함', async () => {
    const queue = { remove: jest.fn().mockResolvedValue(0), add: jest.fn().mockResolvedValue({}) };
    const rank = ranking();
    const producer = new RecommendationProducerService(queue as never, rank as never, config);

    expect(producer.enabled).toBe(true);
    const out = await producer.enqueueOrCompute(data);

    expect(out).toBeNull(); // 큐 경로 — 기록은 PipelineService가
    expect(queue.remove).toHaveBeenCalledWith('recommendation:wr-1:g2');
    const [name, payload, opts] = queue.add.mock.calls[0];
    expect(name).toBe('recommendation');
    expect(payload).toEqual(data);
    expect(opts.jobId).toBe('recommendation:wr-1:g2');
    expect(opts.removeOnComplete).toEqual({ age: 3600, count: 200 }); // returnvalue 읽기 필요
    expect(opts.removeOnFail).toBe(false);
    expect(rank.rank).not.toHaveBeenCalled();
  });

  it('큐 비활성(REDIS_URL 미설정): 인라인 계산 폴백 — generating 고착 방지', async () => {
    const rank = ranking();
    const producer = new RecommendationProducerService(null, rank as never, config);

    expect(producer.enabled).toBe(false);
    const out = await producer.enqueueOrCompute(data);

    expect(out).not.toBeNull();
    expect(out!.jobId).toBe('recommendation:wr-1:g2'); // 경로가 달라도 잡 정체성은 같다
    expect(out!.result.summary).toBe('총평');
    expect(out!.result.candidateCount).toBe(4);
    // 계산 진입점은 어느 경로든 ranking.rank 하나
    expect(rank.rank).toHaveBeenCalledWith({
      weekOf: '2026-06-01',
      generation: 2,
      excludeContentIds: [],
      revisionNote: '날씨 꼭지를 앞으로',
    });
  });

  it('폴백 + 수정지시 없음: revisionNote 키를 넘기지 않는다', async () => {
    const rank = ranking();
    const producer = new RecommendationProducerService(null, rank as never, config);
    await producer.enqueueOrCompute({ ...data, revisionNote: null });
    expect(rank.rank.mock.calls[0][0]).not.toHaveProperty('revisionNote');
  });
});
