import { contentRow } from '../test-support/fixtures';
import { AnalysisProducerService } from './analysis-producer.service';

const originalAsset = { id: 'm-orig', storageKey: 'contents/c-1/g1/original.mp4' };

const setup = (opts: { queue?: unknown } = {}) => {
  const queue = opts.queue === undefined
    ? { add: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) }
    : opts.queue;
  const assets = {
    findOriginal: jest.fn().mockResolvedValue(originalAsset),
    findDurationSec: jest.fn().mockResolvedValue(30),
  };
  const s3 = { bucket: 'gachinol-media' };
  const config = {
    get: jest.fn((key: string) => {
      const map: Record<string, unknown> = {
        AI_ANALYSIS_JOB_ATTEMPTS: 3,
        AI_ANALYSIS_JOB_BACKOFF_MS: 5000,
      };
      return map[key];
    }),
  };
  const service = new AnalysisProducerService(queue as never, assets as never, s3 as never, config as never);
  return { queue, assets, service };
};

describe('AnalysisProducerService', () => {
  it('enabled: queue null → false', () => {
    const { service } = setup({ queue: null });
    expect(service.enabled).toBe(false);
  });

  it('enabled: queue 존재 → true', () => {
    const { service } = setup();
    expect(service.enabled).toBe(true);
  });

  it('enqueueAnalysis: 결정적 jobId·original 좌표·priority normal=5·attempts/backoff/removeOnComplete', async () => {
    const { queue, service } = setup();
    await service.enqueueAnalysis(contentRow());

    expect((queue as any).remove).toHaveBeenCalledWith('analysis:c-1:g1');
    const [name, data, opts] = (queue as any).add.mock.calls[0];
    expect(name).toBe('analyze');
    expect(opts.jobId).toBe('analysis:c-1:g1');
    expect(opts.priority).toBe(5);
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
    expect(opts.removeOnComplete).toEqual({ age: 3600, count: 200 });
    expect(opts.removeOnFail).toBe(false);
    // data 계약
    expect(data.payload).toEqual({
      contentId: 'c-1',
      assetId: 'm-orig',
      generation: 1,
      languageHint: 'ko',
    });
    expect(data.generation).toBe(1);
    expect(data.source).toEqual({ bucket: 'gachinol-media', key: 'contents/c-1/g1/original.mp4' });
    // 트랜스코딩 프로브 실측 재생시간을 힌트로 실어야 함(스텁 퇴화 분석 방지)
    expect(data.durationSec).toBe(30);
  });

  it('enqueueAnalysis: durationSec 미측정(null) → 필드 생략', async () => {
    const { queue, assets, service } = setup();
    (assets as any).findDurationSec.mockResolvedValueOnce(null);
    await service.enqueueAnalysis(contentRow());
    const [, data] = (queue as any).add.mock.calls[0];
    expect('durationSec' in data).toBe(false);
  });

  it('enqueueAnalysis: urgent → priority=1', async () => {
    const { queue, service } = setup();
    await service.enqueueAnalysis(contentRow({ priority: 'urgent' }));
    expect((queue as any).add.mock.calls[0][2].priority).toBe(1);
  });

  it('enqueueAnalysis: queue null → no-op(인큐 생략)', async () => {
    const { assets, service } = setup({ queue: null });
    await service.enqueueAnalysis(contentRow());
    expect(assets.findOriginal).not.toHaveBeenCalled();
  });

  it('requeueForStatus: analyzing → enqueue, 그 외 no-op', async () => {
    const { queue, service } = setup();
    await service.requeueForStatus(contentRow({ status: 'analyzing' }));
    expect((queue as any).add).toHaveBeenCalledTimes(1);
    await service.requeueForStatus(contentRow({ status: 'preview_generating' }));
    expect((queue as any).add).toHaveBeenCalledTimes(1); // 증가 없음
  });
});
