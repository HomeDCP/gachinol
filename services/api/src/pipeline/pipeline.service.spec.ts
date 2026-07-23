import type { ProducedAsset } from '@gachinol/shared';
import { contentRow } from '../test-support/fixtures';
import { PipelineService } from './pipeline.service';

const asset = (kind: ProducedAsset['kind']): ProducedAsset => ({
  kind,
  bucket: 'gachinol-media',
  storageKey: `contents/c-1/g1/${kind}.mp4`,
  mimeType: 'video/mp4',
  sizeBytes: 100,
  checksumSha256: 'x',
});

const makeJob = (over: Record<string, unknown>) => ({
  data: { type: 'transcode', payload: { contentId: 'c-1' }, generation: 1 },
  returnvalue: undefined,
  attemptsMade: 3,
  opts: { attempts: 3 },
  failedReason: undefined,
  ...over,
});

/**
 * setup — analysisEnabled 토글로 AI 활성/비활성 두 경로를 특성화.
 * 생성자 인자 순서: (mediaEvents, mediaQueue, workflow, assets, producer, prisma,
 *   analysisEvents, analysisQueue, analysisProducer, aiAnalyses,
 *   distributionEvents, distributionQueue, publications)
 */
const setup = (opts: { analysisEnabled?: boolean; content?: ReturnType<typeof contentRow> } = {}) => {
  const analysisEnabled = opts.analysisEnabled ?? false;
  const queue = { getJob: jest.fn() };
  const workflow = { applySystemTransition: jest.fn().mockResolvedValue({ applied: true }) };
  const assets = { upsertOutput: jest.fn().mockResolvedValue(undefined) };
  const producer = {
    enqueuePreview: jest.fn().mockResolvedValue(undefined),
    enqueueThumbnail: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    content: { findUnique: jest.fn().mockResolvedValue(opts.content ?? contentRow()) },
    publication: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const analysisProducer = {
    enabled: analysisEnabled,
    enqueueAnalysis: jest.fn().mockResolvedValue(undefined),
  };
  const aiAnalyses = { upsert: jest.fn().mockResolvedValue(undefined) };
  const publications = {
    beginPublishing: jest.fn().mockResolvedValue(true),
    resolveResult: jest.fn().mockResolvedValue(undefined),
    failExhausted: jest.fn().mockResolvedValue(undefined),
    summarizeForContent: jest
      .fn()
      .mockResolvedValue({ anyPending: false, anyFailed: false, allPublished: false }),
  };
  const service = new PipelineService(
    {} as never,
    queue as never,
    workflow as never,
    assets as never,
    producer as never,
    prisma as never,
    {} as never,
    queue as never,
    analysisProducer as never,
    aiAnalyses as never,
    {} as never,
    queue as never,
    publications as never,
  );
  return { queue, workflow, assets, producer, analysisProducer, aiAnalyses, publications, prisma, service };
};

describe('PipelineService — 잡이벤트→상태전이 매핑', () => {
  it('transcode active: uploaded→processing', async () => {
    const { queue, workflow, service } = setup();
    queue.getJob.mockResolvedValue(makeJob({ data: { type: 'transcode', payload: { contentId: 'c-1' }, generation: 1 } }));
    await (service as any).onActive(queue, 'transcode:c-1:g1');
    expect(workflow.applySystemTransition).toHaveBeenCalledWith('c-1', 'uploaded', 'processing', 'transcode:c-1:g1');
  });

  it('transcode completed + AI 비활성: rendition upsert → processing→preview_generating → preview·thumbnail 인큐(직행 폴백)', async () => {
    const { queue, workflow, assets, producer, analysisProducer, service } = setup({ analysisEnabled: false });
    queue.getJob.mockResolvedValue(
      makeJob({
        data: { type: 'transcode', payload: { contentId: 'c-1' }, generation: 1 },
        returnvalue: { assets: [asset('rendition')] },
      }),
    );
    await (service as any).onCompleted(queue, 'transcode:c-1:g1');

    expect(assets.upsertOutput).toHaveBeenCalledWith('c-1', 1, 'transcode:c-1:g1', asset('rendition'));
    expect(workflow.applySystemTransition).toHaveBeenNthCalledWith(1, 'c-1', 'uploaded', 'processing', 'transcode:c-1:g1');
    expect(workflow.applySystemTransition).toHaveBeenNthCalledWith(2, 'c-1', 'processing', 'preview_generating', 'transcode:c-1:g1');
    expect(producer.enqueuePreview).toHaveBeenCalled();
    expect(producer.enqueueThumbnail).toHaveBeenCalled();
    expect(analysisProducer.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it('transcode completed + AI 활성·normal: processing→analyzing → enqueueAnalysis + thumbnail (preview 아님)', async () => {
    const { queue, workflow, producer, analysisProducer, service } = setup({ analysisEnabled: true });
    queue.getJob.mockResolvedValue(
      makeJob({
        data: { type: 'transcode', payload: { contentId: 'c-1' }, generation: 1 },
        returnvalue: { assets: [asset('rendition')] },
      }),
    );
    await (service as any).onCompleted(queue, 'transcode:c-1:g1');

    expect(workflow.applySystemTransition).toHaveBeenNthCalledWith(1, 'c-1', 'uploaded', 'processing', 'transcode:c-1:g1');
    expect(workflow.applySystemTransition).toHaveBeenNthCalledWith(2, 'c-1', 'processing', 'analyzing', 'transcode:c-1:g1');
    expect(analysisProducer.enqueueAnalysis).toHaveBeenCalled();
    expect(producer.enqueueThumbnail).toHaveBeenCalled();
    expect(producer.enqueuePreview).not.toHaveBeenCalled();
  });

  it('transcode completed + urgent(AI 활성이어도): 패스트트랙 processing→preview_generating', async () => {
    const { queue, workflow, producer, analysisProducer, service } = setup({
      analysisEnabled: true,
      content: contentRow({ priority: 'urgent' }),
    });
    queue.getJob.mockResolvedValue(
      makeJob({
        data: { type: 'transcode', payload: { contentId: 'c-1' }, generation: 1 },
        returnvalue: { assets: [asset('rendition')] },
      }),
    );
    await (service as any).onCompleted(queue, 'transcode:c-1:g1');

    expect(workflow.applySystemTransition).toHaveBeenNthCalledWith(2, 'c-1', 'processing', 'preview_generating', 'transcode:c-1:g1');
    expect(producer.enqueuePreview).toHaveBeenCalled();
    expect(analysisProducer.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it('transcode completed에서 홉 미적용(applied=false)이면 후속 인큐 안 함', async () => {
    const { queue, workflow, producer, service } = setup();
    workflow.applySystemTransition.mockResolvedValue({ applied: false });
    queue.getJob.mockResolvedValue(
      makeJob({ returnvalue: { assets: [asset('rendition')] } }),
    );
    await (service as any).onCompleted(queue, 'transcode:c-1:g1');
    expect(producer.enqueuePreview).not.toHaveBeenCalled();
  });

  it('preview completed: preview upsert → preview_generating→awaiting_reporter_review', async () => {
    const { queue, workflow, assets, service } = setup();
    queue.getJob.mockResolvedValue(
      makeJob({
        data: { type: 'preview', payload: { contentId: 'c-1' }, generation: 1 },
        returnvalue: { asset: asset('preview') },
      }),
    );
    await (service as any).onCompleted(queue, 'preview:c-1:g1');
    expect(assets.upsertOutput).toHaveBeenCalledWith('c-1', 1, 'preview:c-1:g1', asset('preview'));
    expect(workflow.applySystemTransition).toHaveBeenCalledWith(
      'c-1',
      'preview_generating',
      'awaiting_reporter_review',
      'preview:c-1:g1',
    );
  });

  it('thumbnail completed: 자산만 upsert, 전이 없음', async () => {
    const { queue, workflow, assets, service } = setup();
    queue.getJob.mockResolvedValue(
      makeJob({
        data: { type: 'thumbnail', payload: { contentId: 'c-1' }, generation: 1 },
        returnvalue: { asset: asset('thumbnail') },
      }),
    );
    await (service as any).onCompleted(queue, 'thumbnail:c-1:g1');
    expect(assets.upsertOutput).toHaveBeenCalled();
    expect(workflow.applySystemTransition).not.toHaveBeenCalled();
  });

  it('analysis completed: ai_analyses upsert → analyzing→preview_generating → enqueuePreview', async () => {
    const { queue, workflow, aiAnalyses, producer, service } = setup({ analysisEnabled: true });
    const resp = { vision: { shots: [], labels: [] }, text: { transcript: [], summary: '', keywords: [], tags: [] } };
    queue.getJob.mockResolvedValue(
      makeJob({
        data: { payload: { contentId: 'c-1' }, generation: 1 },
        returnvalue: resp,
      }),
    );
    await (service as any).onAnalysisCompleted(queue, 'analysis:c-1:g1');

    expect(aiAnalyses.upsert).toHaveBeenCalledWith('c-1', 1, 'analysis:c-1:g1', resp);
    // ensure 체이닝 후 analyzing→preview_generating
    const calls = workflow.applySystemTransition.mock.calls;
    expect(calls).toContainEqual(['c-1', 'processing', 'analyzing', 'analysis:c-1:g1']);
    expect(calls).toContainEqual(['c-1', 'analyzing', 'preview_generating', 'analysis:c-1:g1']);
    expect(producer.enqueuePreview).toHaveBeenCalled();
  });

  it('analysis completed에서 preview_generating 홉 미적용이면 enqueuePreview 안 함', async () => {
    const { queue, workflow, producer, service } = setup({ analysisEnabled: true });
    // preview_generating 홉만 applied=false
    workflow.applySystemTransition.mockImplementation(async (_id: string, _f: string, to: string) => ({
      applied: to !== 'preview_generating',
    }));
    queue.getJob.mockResolvedValue(
      makeJob({ data: { payload: { contentId: 'c-1' }, generation: 1 }, returnvalue: {} }),
    );
    await (service as any).onAnalysisCompleted(queue, 'analysis:c-1:g1');
    expect(producer.enqueuePreview).not.toHaveBeenCalled();
  });

  it('analysis failed 소진: analyzing→analysis_failed(+lastError)', async () => {
    const { queue, workflow, service } = setup({ analysisEnabled: true });
    queue.getJob.mockResolvedValue(
      makeJob({
        data: { payload: { contentId: 'c-1' }, generation: 1 },
        attemptsMade: 3,
        opts: { attempts: 3 },
        failedReason: 'ai-worker 500',
      }),
    );
    await (service as any).onAnalysisFailed(queue, 'analysis:c-1:g1');
    const failCall = workflow.applySystemTransition.mock.calls.find(
      (c: unknown[]) => c[2] === 'analysis_failed',
    );
    expect(failCall).toBeDefined();
    expect(failCall[4].mutate.lastError.message).toBe('ai-worker 500');
  });

  it('analysis failed 미소진: 전이 없음(자동 재시도)', async () => {
    const { queue, workflow, service } = setup({ analysisEnabled: true });
    queue.getJob.mockResolvedValue(
      makeJob({ data: { payload: { contentId: 'c-1' }, generation: 1 }, attemptsMade: 1, opts: { attempts: 3 } }),
    );
    await (service as any).onAnalysisFailed(queue, 'analysis:c-1:g1');
    expect(workflow.applySystemTransition).not.toHaveBeenCalled();
  });

  it('reconcilePending: 종단(completed/failed) 잡을 재조정 경로로 재적용(다운타임 유실 복구)', async () => {
    const { workflow, assets, service } = setup();
    const completedJob = makeJob({
      id: 'transcode:c-1:g1',
      data: { type: 'transcode', payload: { contentId: 'c-1' }, generation: 1 },
      returnvalue: { assets: [asset('rendition')] },
    });
    const failedJob = makeJob({
      id: 'preview:c-9:g1',
      data: { type: 'preview', payload: { contentId: 'c-9' }, generation: 1 },
      attemptsMade: 3,
      opts: { attempts: 3 },
      failedReason: 'preview 실패',
    });
    const getJobs = jest.fn(async (types: string[]) =>
      types[0] === 'completed' ? [completedJob] : [failedJob],
    );
    const reconQueue = { getJob: jest.fn(async (id: string) =>
      id === 'transcode:c-1:g1' ? completedJob : failedJob,
    ), getJobs };

    await (service as any).reconcilePending(reconQueue);

    expect(getJobs).toHaveBeenCalledWith(['completed'], 0, -1, true);
    expect(getJobs).toHaveBeenCalledWith(['failed'], 0, -1, true);
    expect(assets.upsertOutput).toHaveBeenCalledWith('c-1', 1, 'transcode:c-1:g1', asset('rendition'));
    const failCall = workflow.applySystemTransition.mock.calls.find(
      (c: unknown[]) => c[2] === 'preview_failed',
    );
    expect(failCall).toBeDefined();
  });

  it('preview failed 소진: preview_generating→preview_failed', async () => {
    const { queue, workflow, service } = setup();
    queue.getJob.mockResolvedValue(
      makeJob({
        data: { type: 'preview', payload: { contentId: 'c-1' }, generation: 1 },
        attemptsMade: 3,
        opts: { attempts: 3 },
        failedReason: 'preview 실패',
      }),
    );
    await (service as any).onFailed(queue, 'preview:c-1:g1');
    expect(workflow.applySystemTransition).toHaveBeenCalledWith(
      'c-1',
      'preview_generating',
      'preview_failed',
      'preview:c-1:g1',
      expect.objectContaining({ mutate: expect.anything() }),
    );
  });
});
