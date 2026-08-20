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

/** editedMaster: 세대별 edited_master 목 (미지정=없음 → 원본 폴백) */
const makeDeps = (
  over: Partial<ContentRow> = {},
  editedMaster: Record<number, { id: string; storageKey: string }> = {},
) => {
  const queue = { add: jest.fn(), remove: jest.fn().mockResolvedValue(undefined) };
  const original = { id: 'm-orig', storageKey: 'contents/c-1/g1/original.mp4' };
  const assets = {
    findOriginal: jest.fn().mockResolvedValue(original),
    findEditedMaster: jest.fn(async (_id: string, gen: number) => editedMaster[gen] ?? null),
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

  it('enqueuePreview: maxHeight=360·maxBitrateKbps=600 (edited_master 없으면 원본 폴백)', async () => {
    const { queue, content, service } = makeDeps();
    await service.enqueuePreview(content);
    const data = queue.add.mock.calls[0][1];
    expect(data.type).toBe('preview');
    expect(data.payload).toMatchObject({ maxHeight: 360, maxBitrateKbps: 600 });
    expect(data.source.key).toBe('contents/c-1/g1/original.mp4');
  });

  it('★ enqueuePreview/Thumbnail: 현 세대 edited_master가 있으면 그것이 소스 (기자는 편집 결과를 본다)', async () => {
    const master = { id: 'm-edit', storageKey: 'contents/c-1/g1/edited-master.mp4' };
    const { queue, content, service } = makeDeps({}, { 1: master });
    await service.enqueuePreview(content);
    await service.enqueueThumbnail(content);
    expect(queue.add.mock.calls[0][1].source.key).toBe(master.storageKey);
    expect(queue.add.mock.calls[1][1].source.key).toBe(master.storageKey);
  });

  it('enqueueAutoEdit: 1차 생성은 원본이 소스, editPlan은 기본 null(= 컷 없는 기계편집)', async () => {
    const { queue, content, service } = makeDeps();
    await service.enqueueAutoEdit(content);
    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe('auto_edit');
    expect(opts.jobId).toBe('auto_edit:c-1:g1');
    expect(data.source.key).toBe('contents/c-1/g1/original.mp4');
    expect(data.payload).toMatchObject({ editPlan: null, reanalyze: false, revisionRequestId: null });
  });

  it('★ enqueueAutoEdit: 재생성은 **직전 세대** edited_master가 소스 (원본 재편집 대비 5배 빠름)', async () => {
    const prev = { id: 'm-edit-g1', storageKey: 'contents/c-1/g1/edited-master.mp4' };
    const { queue, content, service } = makeDeps({ generation: 2 }, { 1: prev });
    await service.enqueueAutoEdit(content, { reanalyze: true, revisionRequestId: 'r-1' });
    const [, data, opts] = queue.add.mock.calls[0];
    expect(opts.jobId).toBe('auto_edit:c-1:g2');
    expect(data.source.key).toBe(prev.storageKey);
    expect(data.outputKeyPrefix).toBe('contents/c-1/g2/'); // 산출물은 새 세대로
    expect(data.payload).toMatchObject({ reanalyze: true, revisionRequestId: 'r-1' });
  });

  it('enqueueAutoEdit: 직전 세대 마스터가 없으면(이전 세대 실패 등) 원본으로 폴백', async () => {
    const { queue, content, service } = makeDeps({ generation: 3 });
    await service.enqueueAutoEdit(content);
    expect(queue.add.mock.calls[0][1].source.key).toBe('contents/c-1/g1/original.mp4');
  });

  it('queue=null(Redis 미설정)이면 enabled=false·add 미호출', async () => {
    const assets = { findOriginal: jest.fn().mockResolvedValue({ id: 'x', storageKey: 'k' }), outputPrefix: () => 'p/' } as never;
    const s3 = { bucket: 'b' } as never;
    const config = { get: (k: string) => ENV[k] } as never;
    const service = new QueueProducerService(null, assets, s3, config);
    expect(service.enabled).toBe(false);
    await expect(service.enqueueTranscode(contentRow())).resolves.toBeUndefined();
  });

  it('★ requeueForStatus: preview_generating은 **auto_edit부터** 재큐한다 (preview만 재큐하면 편집이 통째로 누락)', async () => {
    const t = makeDeps({ status: 'processing' });
    await t.service.requeueForStatus(t.content);
    expect(t.queue.add.mock.calls[0][0]).toBe('transcode');

    // preview_generating 안에서는 auto_edit → preview 순으로 돈다. 재시도도 그 시작점부터여야 한다.
    const p = makeDeps({ status: 'preview_generating' });
    await p.service.requeueForStatus(p.content);
    expect(p.queue.add.mock.calls[0][0]).toBe('auto_edit');

    // regeneration_failed 재시도 목적지(CONTENT_RETRY_TARGET)도 auto_edit이다
    const r = makeDeps({ status: 'regenerating', generation: 2 });
    await r.service.requeueForStatus(r.content);
    expect(r.queue.add.mock.calls[0][0]).toBe('auto_edit');

    const u = makeDeps({ status: 'uploading' });
    await u.service.requeueForStatus(u.content);
    expect(u.queue.add).not.toHaveBeenCalled();
  });
});
