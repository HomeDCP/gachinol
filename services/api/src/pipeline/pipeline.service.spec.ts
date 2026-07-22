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

const setup = () => {
  const queue = { getJob: jest.fn() };
  const workflow = { applySystemTransition: jest.fn().mockResolvedValue({ applied: true }) };
  const assets = { upsertOutput: jest.fn().mockResolvedValue(undefined) };
  const producer = {
    enqueuePreview: jest.fn().mockResolvedValue(undefined),
    enqueueThumbnail: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = { content: { findUnique: jest.fn().mockResolvedValue(contentRow()) } };
  const service = new PipelineService(
    {} as never,
    queue as never,
    workflow as never,
    assets as never,
    producer as never,
    prisma as never,
  );
  return { queue, workflow, assets, producer, service };
};

describe('PipelineService — 잡이벤트→상태전이 매핑', () => {
  it('transcode active: uploaded→processing', async () => {
    const { queue, workflow, service } = setup();
    queue.getJob.mockResolvedValue(makeJob({ data: { type: 'transcode', payload: { contentId: 'c-1' }, generation: 1 } }));
    await (service as any).onActive(queue, 'transcode:c-1:g1');
    expect(workflow.applySystemTransition).toHaveBeenCalledWith('c-1', 'uploaded', 'processing', 'transcode:c-1:g1');
  });

  it('transcode completed: rendition upsert → ensure + processing→preview_generating → preview·thumbnail 인큐', async () => {
    const { queue, workflow, assets, producer, service } = setup();
    queue.getJob.mockResolvedValue(
      makeJob({
        data: { type: 'transcode', payload: { contentId: 'c-1' }, generation: 1 },
        returnvalue: { assets: [asset('rendition')] },
      }),
    );
    await (service as any).onCompleted(queue, 'transcode:c-1:g1');

    expect(assets.upsertOutput).toHaveBeenCalledWith('c-1', 1, 'transcode:c-1:g1', asset('rendition'));
    // ensure(uploaded→processing) 선행 + processing→preview_generating
    expect(workflow.applySystemTransition).toHaveBeenNthCalledWith(1, 'c-1', 'uploaded', 'processing', 'transcode:c-1:g1');
    expect(workflow.applySystemTransition).toHaveBeenNthCalledWith(2, 'c-1', 'processing', 'preview_generating', 'transcode:c-1:g1');
    expect(producer.enqueuePreview).toHaveBeenCalled();
    expect(producer.enqueueThumbnail).toHaveBeenCalled();
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

  it('transcode failed 소진: processing→processing_failed(+lastError)', async () => {
    const { queue, workflow, service } = setup();
    queue.getJob.mockResolvedValue(
      makeJob({ attemptsMade: 3, opts: { attempts: 3 }, failedReason: 'ffmpeg 실패' }),
    );
    await (service as any).onFailed(queue, 'transcode:c-1:g1');
    const failCall = workflow.applySystemTransition.mock.calls.find(
      (c: unknown[]) => c[2] === 'processing_failed',
    );
    expect(failCall).toBeDefined();
    expect(failCall[4].mutate.lastError.message).toBe('ffmpeg 실패');
  });

  it('failed 미소진(attemptsMade<attempts): 전이 없음(자동 재시도)', async () => {
    const { queue, workflow, service } = setup();
    queue.getJob.mockResolvedValue(makeJob({ attemptsMade: 1, opts: { attempts: 3 } }));
    await (service as any).onFailed(queue, 'transcode:c-1:g1');
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
    // completed 경로: rendition upsert + processing→preview_generating 전이
    expect(assets.upsertOutput).toHaveBeenCalledWith('c-1', 1, 'transcode:c-1:g1', asset('rendition'));
    // failed 경로: preview_generating→preview_failed 전이
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
