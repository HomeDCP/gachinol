import type { ConfigService } from '@nestjs/config';
import type { Content as ContentRow } from '@prisma/client';
import { contentRow } from '../test-support/fixtures';
import type { MediaAssetsService } from '../media/media-assets.service';
import type { S3Service } from '../media/s3.service';
import { QueueProducerService } from './queue-producer.service';

const ENV: Record<string, unknown> = {
  MEDIA_RENDITION_HEIGHT: 720,
  MEDIA_PREVIEW_HEIGHT: 360,
  MEDIA_PREVIEW_BITRATE_KBPS: 600,
  MEDIA_JOB_ATTEMPTS: 3,
  MEDIA_JOB_BACKOFF_MS: 5000,
};

const makeDeps = (over: Partial<ContentRow> = {}) => {
  const queue = { add: jest.fn(), remove: jest.fn().mockResolvedValue(undefined) };
  const original = { id: 'm-orig', storageKey: 'contents/c-1/g1/original.mp4' };
  const assets = {
    findOriginal: jest.fn().mockResolvedValue(original),
    outputPrefix: (id: string, gen: number) => `contents/${id}/g${gen}/`,
  } as unknown as MediaAssetsService;
  const s3 = { bucket: 'gachinol-media' } as unknown as S3Service;
  const config = { get: (k: string) => ENV[k] } as unknown as ConfigService<never, true>;
  const content = contentRow({ id: 'c-1', generation: 1, ...over });
  const service = new QueueProducerService(queue as never, assets, s3, config);
  return { queue, assets, content, service };
};

describe('QueueProducerService — 인큐 조립', () => {
  it('enqueueTranscode: 결정적 jobId, priority=5(normal), 720p payload, source=original 좌표', async () => {
    const { queue, content, service } = makeDeps();
    await service.enqueueTranscode(content);

    expect(queue.remove).toHaveBeenCalledWith('transcode:c-1:g1');
    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe('transcode');
    expect(opts.jobId).toBe('transcode:c-1:g1');
    expect(opts.priority).toBe(5);
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
    expect(opts.removeOnComplete).toEqual({ age: 3600, count: 200 });
    expect(opts.removeOnFail).toBe(false);
    expect(data).toMatchObject({
      type: 'transcode',
      generation: 1,
      source: { bucket: 'gachinol-media', key: 'contents/c-1/g1/original.mp4' },
      outputBucket: 'gachinol-media',
      outputKeyPrefix: 'contents/c-1/g1/',
    });
    expect(data.payload.renditionLabels).toEqual(['720p']);
  });

  it('urgent 우선순위 → priority=1', async () => {
    const { queue, content, service } = makeDeps({ priority: 'urgent' });
    await service.enqueueTranscode(content);
    expect(queue.add.mock.calls[0][2].priority).toBe(1);
  });

  it('enqueuePreview: maxHeight=360·maxBitrateKbps=600', async () => {
    const { queue, content, service } = makeDeps();
    await service.enqueuePreview(content);
    const data = queue.add.mock.calls[0][1];
    expect(data.type).toBe('preview');
    expect(data.payload).toMatchObject({ maxHeight: 360, maxBitrateKbps: 600 });
  });

  it('queue=null(Redis 미설정)이면 enabled=false·add 미호출', async () => {
    const assets = { findOriginal: jest.fn().mockResolvedValue({ id: 'x', storageKey: 'k' }), outputPrefix: () => 'p/' } as never;
    const s3 = { bucket: 'b' } as never;
    const config = { get: (k: string) => ENV[k] } as never;
    const service = new QueueProducerService(null, assets, s3, config);
    expect(service.enabled).toBe(false);
    await expect(service.enqueueTranscode(contentRow())).resolves.toBeUndefined();
  });

  it('requeueForStatus: processing→transcode, preview_generating→preview, 그 외 무동작', async () => {
    const t = makeDeps({ status: 'processing' });
    await t.service.requeueForStatus(t.content);
    expect(t.queue.add.mock.calls[0][0]).toBe('transcode');

    const p = makeDeps({ status: 'preview_generating' });
    await p.service.requeueForStatus(p.content);
    expect(p.queue.add.mock.calls[0][0]).toBe('preview');

    const u = makeDeps({ status: 'uploading' });
    await u.service.requeueForStatus(u.content);
    expect(u.queue.add).not.toHaveBeenCalled();
  });
});
