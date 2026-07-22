import type { ProducedAsset } from '@gachinol/shared';
import { makePrismaMock } from '../test-support/fixtures';
import { MediaAssetsService } from './media-assets.service';

describe('MediaAssetsService — 멱등 생성·키 규약', () => {
  const setup = () => {
    const prisma = makePrismaMock();
    prisma.mediaAsset.upsert.mockImplementation(async ({ create }: any) => ({ ...create }));
    const s3 = { bucket: 'gachinol-media' } as never;
    return { prisma, service: new MediaAssetsService(prisma, s3) };
  };

  it('originalKey/outputPrefix 규약: contents/{id}/g{n}/', () => {
    const { service } = setup();
    expect(service.originalKey('c-1', 'mp4')).toBe('contents/c-1/g1/original.mp4');
    expect(service.outputPrefix('c-1', 2)).toBe('contents/c-1/g2/');
  });

  it('createOriginalPending: (bucket,storageKey) upsert 키·sizeBytes BigInt·kind=original/pending', async () => {
    const { prisma, service } = setup();
    await service.createOriginalPending('c-1', 'contents/c-1/g1/original.mp4', 'video/mp4', 12345);
    const call = prisma.mediaAsset.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      bucket_storageKey: { bucket: 'gachinol-media', storageKey: 'contents/c-1/g1/original.mp4' },
    });
    expect(call.create).toMatchObject({
      ownerKind: 'content',
      contentId: 'c-1',
      kind: 'original',
      status: 'pending',
      generation: 1,
      mimeType: 'video/mp4',
    });
    expect(call.create.sizeBytes).toBe(BigInt(12345));
    expect(call.update).toEqual({}); // 재-issue 멱등
  });

  it('upsertOutput: (bucket,storageKey)로 upsert, status=ready·checksum·createdByJobId 기록', async () => {
    const { prisma, service } = setup();
    const out: ProducedAsset = {
      kind: 'preview',
      bucket: 'gachinol-media',
      storageKey: 'contents/c-1/g1/preview.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 999,
      checksumSha256: 'deadbeef',
      height: 360,
      renditionLabel: 'preview-360p',
    };
    await service.upsertOutput('c-1', 1, 'preview:c-1:g1', out);
    const call = prisma.mediaAsset.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      bucket_storageKey: { bucket: 'gachinol-media', storageKey: 'contents/c-1/g1/preview.mp4' },
    });
    expect(call.create).toMatchObject({
      kind: 'preview',
      status: 'ready',
      checksumSha256: 'deadbeef',
      createdByJobId: 'preview:c-1:g1',
      height: 360,
      renditionLabel: 'preview-360p',
    });
    expect(call.create.sizeBytes).toBe(BigInt(999));
    // update는 메타 갱신하되 id/createdByJobId 미포함(생성 계보 보존)
    expect(call.update.createdByJobId).toBeUndefined();
    expect(call.update.status).toBe('ready');
  });

  it('markReady: original을 ready로 + size 갱신', async () => {
    const { prisma, service } = setup();
    await service.markReady('contents/c-1/g1/original.mp4', { sizeBytes: 42 });
    const call = prisma.mediaAsset.update.mock.calls[0][0];
    expect(call.data.status).toBe('ready');
    expect(call.data.sizeBytes).toBe(BigInt(42));
  });

  it('findOriginal: kind=original, generation=1, failed 배제 + createdAt desc 결정적 조회', async () => {
    const { prisma, service } = setup();
    prisma.mediaAsset.findFirst.mockResolvedValue(null);
    await service.findOriginal('c-1');
    expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: { contentId: 'c-1', kind: 'original', generation: 1, status: { not: 'failed' } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('createOriginalPending: 재발급 시 현재 키 외 이전 original 행 정리(단일 원본 불변식)', async () => {
    const { prisma, service } = setup();
    await service.createOriginalPending('c-1', 'contents/c-1/g1/original.mov', 'video/quicktime', 42);
    expect(prisma.mediaAsset.deleteMany).toHaveBeenCalledWith({
      where: {
        contentId: 'c-1',
        kind: 'original',
        generation: 1,
        storageKey: { not: 'contents/c-1/g1/original.mov' },
      },
    });
  });
});
