import type { Content as ContentRow, MediaAsset as MediaAssetRow } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { encodeFeedCursor } from './feed.cursor';
import { FeedService } from './feed.service';
import type { FeedQueryDto } from './schemas/feed.schemas';

type FeedRow = ContentRow & { station: { name: string } };

const row = (over: Partial<FeedRow> = {}): FeedRow =>
  ({
    id: '01920000-0000-7000-8000-0000000000a1',
    stationId: '01920000-0000-7000-8000-000000000001',
    origin: 'live_vod',
    reporterId: null,
    title: '제목',
    description: null,
    category: 'news',
    cultureTopics: [],
    status: 'published',
    priority: 'normal',
    reviewPolicy: 'reporter_only',
    generation: 1,
    scenes: [],
    targetChannelAccountIds: [],
    tags: [],
    remakeOfContentId: null,
    lastError: null,
    durationSec: 100,
    approvedByUserId: null,
    approvedAt: null,
    publishedAt: new Date('2026-07-20T09:00:00.000Z'),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    station: { name: '애월 마을방송국' },
    ...over,
  }) as FeedRow;

const rendition = (over: Partial<MediaAssetRow> = {}): MediaAssetRow =>
  ({
    id: 'asset-r',
    ownerKind: 'content',
    contentId: '01920000-0000-7000-8000-0000000000a1',
    kind: 'rendition',
    status: 'ready',
    generation: 1,
    bucket: 'gachinol-media',
    storageKey: 'contents/x/g1/rendition_720p.mp4',
    mimeType: 'video/mp4',
    sizeBytes: null,
    durationSec: 120,
    width: 1280,
    height: 720,
    bitrateKbps: null,
    videoCodec: null,
    audioCodec: null,
    renditionLabel: '720p',
    checksumSha256: null,
    createdByJobId: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...over,
  }) as MediaAssetRow;

const makeService = () => {
  const prisma = {
    content: { findMany: jest.fn(), findUnique: jest.fn() },
    mediaAsset: { findMany: jest.fn(), findFirst: jest.fn() },
    aiAnalysis: { findMany: jest.fn() },
    station: { findMany: jest.fn() },
  };
  const s3 = { presignGet: jest.fn() };
  const service = new FeedService(prisma as never, s3 as never);
  return { service, prisma, s3 };
};

const q = (over: Partial<FeedQueryDto> = {}): FeedQueryDto =>
  ({ limit: 20, ...over }) as FeedQueryDto;

describe('FeedService.list', () => {
  it('where에 status:published 고정 + 필터 병합, take limit+1, published만', async () => {
    const { service, prisma, s3 } = makeService();
    prisma.content.findMany.mockResolvedValue([row()]);
    prisma.mediaAsset.findMany.mockResolvedValue([]);
    prisma.aiAnalysis.findMany.mockResolvedValue([]);
    s3.presignGet.mockResolvedValue({ url: 'signed', expiresAt: 'x' });

    await service.list(
      q({ limit: 10, stationId: '01920000-0000-7000-8000-000000000001' as never, category: 'news' as never }),
    );

    const arg = prisma.content.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('published');
    expect(arg.where.stationId).toBe('01920000-0000-7000-8000-000000000001');
    expect(arg.where.category).toBe('news');
    expect(arg.take).toBe(11); // limit+1
    expect(arg.orderBy).toEqual([{ publishedAt: 'desc' }, { id: 'desc' }]);
  });

  it('limit+1째 존재 → 마지막 반환행으로 nextCursor, 없으면 null', async () => {
    const { service, prisma, s3 } = makeService();
    // limit 1, 2행 반환(=hasMore)
    const first = row({ id: 'id-1', publishedAt: new Date('2026-07-20T09:00:00.000Z') });
    const second = row({ id: 'id-2', publishedAt: new Date('2026-07-19T09:00:00.000Z') });
    prisma.content.findMany.mockResolvedValue([first, second]);
    prisma.mediaAsset.findMany.mockResolvedValue([]);
    prisma.aiAnalysis.findMany.mockResolvedValue([]);
    s3.presignGet.mockResolvedValue({ url: 'signed', expiresAt: 'x' });

    const page = await service.list(q({ limit: 1 }));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.contentId).toBe('id-1');
    // nextCursor는 반환된 마지막(id-1)에서 산출
    expect(page.nextCursor).toBe(
      encodeFeedCursor(first.publishedAt!.toISOString(), 'id-1'),
    );
  });

  it('마지막 페이지 → nextCursor null', async () => {
    const { service, prisma, s3 } = makeService();
    prisma.content.findMany.mockResolvedValue([row()]);
    prisma.mediaAsset.findMany.mockResolvedValue([]);
    prisma.aiAnalysis.findMany.mockResolvedValue([]);
    s3.presignGet.mockResolvedValue({ url: 'signed', expiresAt: 'x' });
    const page = await service.list(q({ limit: 20 }));
    expect(page.nextCursor).toBeNull();
  });

  it('커서 제공 시 keyset where(OR) 구성', async () => {
    const { service, prisma } = makeService();
    prisma.content.findMany.mockResolvedValue([]);
    const cursor = encodeFeedCursor('2026-07-20T09:00:00.000Z', 'id-1');
    await service.list(q({ cursor }));
    const arg = prisma.content.findMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { publishedAt: { lt: new Date('2026-07-20T09:00:00.000Z') } },
      { publishedAt: new Date('2026-07-20T09:00:00.000Z'), id: { lt: 'id-1' } },
    ]);
  });

  it('손상 커서 → validation_failed (fail-closed)', async () => {
    const { service } = makeService();
    await expect(service.list(q({ cursor: 'garbage!!!' }))).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('썸네일 서명 실패 → best-effort, thumbnailUrl 생략 (피드 500 금지)', async () => {
    const { service, prisma, s3 } = makeService();
    prisma.content.findMany.mockResolvedValue([row()]);
    prisma.mediaAsset.findMany.mockResolvedValue([
      { contentId: '01920000-0000-7000-8000-0000000000a1', generation: 1, storageKey: 'k', kind: 'thumbnail' },
    ]);
    prisma.aiAnalysis.findMany.mockResolvedValue([]);
    s3.presignGet.mockRejectedValue(new DomainException('internal', 'S3 미설정'));
    const page = await service.list(q());
    expect(page.items[0]).not.toHaveProperty('thumbnailUrl');
  });

  it('요약·썸네일은 content.generation 일치분만 채택', async () => {
    const { service, prisma, s3 } = makeService();
    prisma.content.findMany.mockResolvedValue([row({ generation: 2 })]);
    prisma.mediaAsset.findMany.mockResolvedValue([
      // generation 1 — 불일치 → 무시
      { contentId: '01920000-0000-7000-8000-0000000000a1', generation: 1, storageKey: 'old', kind: 'thumbnail' },
    ]);
    prisma.aiAnalysis.findMany.mockResolvedValue([
      { contentId: '01920000-0000-7000-8000-0000000000a1', generation: 1, text: { summary: '옛요약' } },
    ]);
    s3.presignGet.mockResolvedValue({ url: 'signed', expiresAt: 'x' });
    const page = await service.list(q());
    expect(page.items[0]).not.toHaveProperty('thumbnailUrl');
    expect(page.items[0]).not.toHaveProperty('summary');
    expect(s3.presignGet).not.toHaveBeenCalled();
  });
});

describe('FeedService.getPlayback', () => {
  it('콘텐츠 부재 → not_found', async () => {
    const { service, prisma } = makeService();
    prisma.content.findUnique.mockResolvedValue(null);
    await expect(service.getPlayback('x')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('비published → not_found (내부 비노출)', async () => {
    const { service, prisma } = makeService();
    prisma.content.findUnique.mockResolvedValue(row({ status: 'draft' }));
    await expect(service.getPlayback('x')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rendition 부재 → not_found', async () => {
    const { service, prisma } = makeService();
    prisma.content.findUnique.mockResolvedValue(row());
    prisma.mediaAsset.findMany.mockResolvedValue([]);
    await expect(service.getPlayback('x')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('720p 우선 채택 + hlsUrl 서명', async () => {
    const { service, prisma, s3 } = makeService();
    prisma.content.findUnique.mockResolvedValue(
      row({
        scenes: [
          { id: '01920000-0000-7000-8000-0000000000b1', order: 0, caption: '자막', startSec: 0, endSec: 5 },
          { id: '01920000-0000-7000-8000-0000000000b2', order: 1, caption: '타이밍없음', startSec: null, endSec: null },
        ] as never,
      }),
    );
    prisma.mediaAsset.findMany.mockResolvedValue([
      rendition({ renditionLabel: '480p', storageKey: 'k480' }),
      rendition({ renditionLabel: '720p', storageKey: 'k720' }),
    ]);
    prisma.mediaAsset.findFirst.mockResolvedValue(null); // no thumbnail
    s3.presignGet.mockResolvedValue({ url: 'signed-720', expiresAt: 'x' });

    const info = await service.getPlayback('x');
    expect(s3.presignGet).toHaveBeenCalledWith('k720');
    expect(info.hlsUrl).toBe('signed-720');
    expect(info.captions).toEqual([{ startSec: 0, endSec: 5, text: '자막' }]);
    expect(info).not.toHaveProperty('posterUrl');
  });

  it('durationSec: content null → rendition 폴백', async () => {
    const { service, prisma, s3 } = makeService();
    prisma.content.findUnique.mockResolvedValue(row({ durationSec: null }));
    prisma.mediaAsset.findMany.mockResolvedValue([rendition({ durationSec: 120 })]);
    prisma.mediaAsset.findFirst.mockResolvedValue(null);
    s3.presignGet.mockResolvedValue({ url: 'u', expiresAt: 'x' });
    const info = await service.getPlayback('x');
    expect(info.durationSec).toBe(120);
  });

  it('poster 서명 실패 → best-effort 생략, hlsUrl은 유지', async () => {
    const { service, prisma, s3 } = makeService();
    prisma.content.findUnique.mockResolvedValue(row());
    prisma.mediaAsset.findMany.mockResolvedValue([rendition()]);
    prisma.mediaAsset.findFirst.mockResolvedValue(rendition({ kind: 'thumbnail', storageKey: 'thumb' }));
    s3.presignGet
      .mockResolvedValueOnce({ url: 'signed-rendition', expiresAt: 'x' }) // hls
      .mockRejectedValueOnce(new DomainException('internal', 'x')); // poster
    const info = await service.getPlayback('x');
    expect(info.hlsUrl).toBe('signed-rendition');
    expect(info).not.toHaveProperty('posterUrl');
  });
});

describe('FeedService — 공개 URL(D-T8) 우선, 서명 URL 폴백', () => {
  const makeServiceWithPublicMedia = () => {
    const prisma = {
      content: { findMany: jest.fn(), findUnique: jest.fn() },
      mediaAsset: { findMany: jest.fn(), findFirst: jest.fn() },
      aiAnalysis: { findMany: jest.fn() },
      station: { findMany: jest.fn() },
    };
    const s3 = { presignGet: jest.fn() };
    const publicMedia = { resolvePublicUrl: jest.fn() };
    const service = new FeedService(prisma as never, s3 as never, publicMedia as never);
    return { service, prisma, s3, publicMedia };
  };

  it('getPlayback: 공개 URL이 있으면 hlsUrl로 채택하고 presignGet은 호출하지 않는다', async () => {
    const { service, prisma, s3, publicMedia } = makeServiceWithPublicMedia();
    prisma.content.findUnique.mockResolvedValue(row());
    prisma.mediaAsset.findMany.mockResolvedValue([rendition()]);
    prisma.mediaAsset.findFirst.mockResolvedValue(null);
    publicMedia.resolvePublicUrl.mockResolvedValue('https://media.example.com/public/k720.mp4');

    const info = await service.getPlayback('x');

    expect(publicMedia.resolvePublicUrl).toHaveBeenCalledWith('contents/x/g1/rendition_720p.mp4');
    expect(info.hlsUrl).toBe('https://media.example.com/public/k720.mp4');
    expect(s3.presignGet).not.toHaveBeenCalled();
  });

  it('getPlayback: 공개 URL 부재(null) → 기존 서명 URL로 폴백', async () => {
    const { service, prisma, s3, publicMedia } = makeServiceWithPublicMedia();
    prisma.content.findUnique.mockResolvedValue(row());
    prisma.mediaAsset.findMany.mockResolvedValue([rendition()]);
    prisma.mediaAsset.findFirst.mockResolvedValue(null);
    publicMedia.resolvePublicUrl.mockResolvedValue(null);
    s3.presignGet.mockResolvedValue({ url: 'signed-fallback', expiresAt: 'x' });

    const info = await service.getPlayback('x');

    expect(info.hlsUrl).toBe('signed-fallback');
    expect(s3.presignGet).toHaveBeenCalledWith('contents/x/g1/rendition_720p.mp4');
  });

  it('getPlayback: 공개 URL 조회 자체가 예외를 던져도 서명 URL로 폴백(throw 없음)', async () => {
    const { service, prisma, s3, publicMedia } = makeServiceWithPublicMedia();
    prisma.content.findUnique.mockResolvedValue(row());
    prisma.mediaAsset.findMany.mockResolvedValue([rendition()]);
    prisma.mediaAsset.findFirst.mockResolvedValue(null);
    publicMedia.resolvePublicUrl.mockRejectedValue(new Error('S3 down'));
    s3.presignGet.mockResolvedValue({ url: 'signed-fallback', expiresAt: 'x' });

    const info = await service.getPlayback('x');
    expect(info.hlsUrl).toBe('signed-fallback');
  });

  it('list: 썸네일도 공개 URL 우선으로 채택한다', async () => {
    const { service, prisma, s3, publicMedia } = makeServiceWithPublicMedia();
    prisma.content.findMany.mockResolvedValue([row()]);
    prisma.mediaAsset.findMany.mockResolvedValue([
      rendition({ kind: 'thumbnail', storageKey: 'thumb-key' }),
    ]);
    prisma.aiAnalysis.findMany.mockResolvedValue([]);
    publicMedia.resolvePublicUrl.mockResolvedValue('https://media.example.com/public/thumb.jpg');

    const page = await service.list(q());

    expect(page.items[0]!.thumbnailUrl).toBe('https://media.example.com/public/thumb.jpg');
    expect(s3.presignGet).not.toHaveBeenCalled();
  });
});

describe('FeedService.listPublicStations', () => {
  it('branch + operating|dormant, sortOrder asc', async () => {
    const { service, prisma } = makeService();
    prisma.station.findMany.mockResolvedValue([]);
    await service.listPublicStations();
    const arg = prisma.station.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ kind: 'branch', status: { in: ['operating', 'dormant'] } });
    expect(arg.orderBy).toEqual({ sortOrder: 'asc' });
  });
});
