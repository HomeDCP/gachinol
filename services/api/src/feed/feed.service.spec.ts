import type { Content as ContentRow, MediaAsset as MediaAssetRow } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { PublicMediaService } from '../media/public-media.service';
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
    // 공개 사본 기록(T-W2-33) — 기본은 "사본 모름" → 서명 URL 폴백
    publicBucket: null,
    publicKey: null,
    publicCopiedAt: null,
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
    const publicMedia = { publicUrlForAsset: jest.fn() };
    const service = new FeedService(prisma as never, s3 as never, publicMedia as never);
    return { service, prisma, s3, publicMedia };
  };

  it('getPlayback: 공개 URL이 있으면 hlsUrl로 채택하고 presignGet은 호출하지 않는다', async () => {
    const { service, prisma, s3, publicMedia } = makeServiceWithPublicMedia();
    prisma.content.findUnique.mockResolvedValue(row());
    prisma.mediaAsset.findMany.mockResolvedValue([rendition()]);
    prisma.mediaAsset.findFirst.mockResolvedValue(null);
    publicMedia.publicUrlForAsset.mockReturnValue('https://media.example.com/public/k720.mp4');

    const info = await service.getPlayback('x');

    // storageKey가 아니라 자산 행 전체를 넘긴다(공개 사본 기록이 그 행에 실려 있다 — T-W2-33)
    expect(publicMedia.publicUrlForAsset).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: 'contents/x/g1/rendition_720p.mp4' }),
    );
    expect(info.hlsUrl).toBe('https://media.example.com/public/k720.mp4');
    expect(s3.presignGet).not.toHaveBeenCalled();
  });

  it('getPlayback: 공개 URL 부재(null) → 기존 서명 URL로 폴백', async () => {
    const { service, prisma, s3, publicMedia } = makeServiceWithPublicMedia();
    prisma.content.findUnique.mockResolvedValue(row());
    prisma.mediaAsset.findMany.mockResolvedValue([rendition()]);
    prisma.mediaAsset.findFirst.mockResolvedValue(null);
    publicMedia.publicUrlForAsset.mockReturnValue(null);
    s3.presignGet.mockResolvedValue({ url: 'signed-fallback', expiresAt: 'x' });

    const info = await service.getPlayback('x');

    expect(info.hlsUrl).toBe('signed-fallback');
    expect(s3.presignGet).toHaveBeenCalledWith('contents/x/g1/rendition_720p.mp4');
  });

  it('getPlayback: 공개 URL 판정이 예외를 던져도 서명 URL로 폴백(throw 없음)', async () => {
    const { service, prisma, s3, publicMedia } = makeServiceWithPublicMedia();
    prisma.content.findUnique.mockResolvedValue(row());
    prisma.mediaAsset.findMany.mockResolvedValue([rendition()]);
    prisma.mediaAsset.findFirst.mockResolvedValue(null);
    publicMedia.publicUrlForAsset.mockImplementation(() => {
      throw new Error('boom');
    });
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
    publicMedia.publicUrlForAsset.mockReturnValue('https://media.example.com/public/thumb.jpg');

    const page = await service.list(q());

    expect(page.items[0]!.thumbnailUrl).toBe('https://media.example.com/public/thumb.jpg');
    expect(s3.presignGet).not.toHaveBeenCalled();
  });
});

/**
 * 대장 #129 ⓐ 회귀 방어 — **공개 서빙이 켜진 상태에서 피드 목록의 S3 왕복이 0회**임을 실 서비스로 증명한다.
 * (목이 아니라 진짜 PublicMediaService를 주입해야 의미가 있다 — 목을 쓰면 HEAD 호출을 목이 삼킨다.)
 * 변경 전 구현은 항목마다 `resolvePublicUrl` → `headObject` 1회였으므로 N건 = HEAD N회였다.
 */
describe('FeedService.list — 공개 서빙 ON에서 S3 HEAD 0회(대장 #129 ⓐ)', () => {
  const N = 20; // 피드 1페이지 기본 크기

  const makeRealPublicMedia = (headObject: jest.Mock) => {
    const config = {
      get: (k: string) =>
        (
          ({
            MEDIA_PUBLIC_BUCKET: undefined,
            MEDIA_PUBLIC_PREFIX: 'public',
            MEDIA_PUBLIC_BASE_URL: 'https://media.example.com', // ← 공개 서빙 ON
          }) as Record<string, unknown>
        )[k],
    };
    const s3 = { bucket: 'gachinol-media', headObject };
    return new PublicMediaService({} as never, s3 as never, {} as never, config as never);
  };

  it(`published ${N}건(전부 공개 사본 기록 있음) 조회 → headObject 0회 · presignGet 0회 · 전건 공개 URL`, async () => {
    const headObject = jest.fn().mockResolvedValue({ sizeBytes: 1 });
    const prisma = {
      content: { findMany: jest.fn(), findUnique: jest.fn() },
      mediaAsset: { findMany: jest.fn(), findFirst: jest.fn() },
      aiAnalysis: { findMany: jest.fn() },
      station: { findMany: jest.fn() },
    };
    const s3 = { presignGet: jest.fn() };
    const service = new FeedService(prisma as never, s3 as never, makeRealPublicMedia(headObject));

    const contents = Array.from({ length: N }, (_, i) =>
      row({ id: `01920000-0000-7000-8000-0000000000${String(i).padStart(2, '0')}` }),
    );
    prisma.content.findMany.mockResolvedValue(contents);
    prisma.mediaAsset.findMany.mockResolvedValue(
      contents.map((c, i) =>
        rendition({
          id: `thumb-${i}`,
          contentId: c.id,
          kind: 'thumbnail',
          storageKey: `contents/${c.id}/g1/thumbnail.jpg`,
          publicBucket: 'gachinol-media',
          publicKey: `public/contents/${c.id}/g1/thumbnail.jpg`,
          publicCopiedAt: new Date('2026-07-02T00:00:00.000Z'),
        }),
      ),
    );
    prisma.aiAnalysis.findMany.mockResolvedValue([]);

    const page = await service.list(q({ limit: N }));

    expect(page.items).toHaveLength(N);
    // 전건이 공개 URL로 해석됐다 = 변경 전이라면 자산 존재 확인 HEAD가 N회 필요했던 분량
    expect(page.items.filter((it) => it.thumbnailUrl?.startsWith('https://media.example.com/')))
      .toHaveLength(N);
    expect(headObject).toHaveBeenCalledTimes(0); // ★ 변경 전: N(=20)회
    expect(s3.presignGet).toHaveBeenCalledTimes(0);
  });

  it(`공개 사본 기록이 없는 ${N}건 → 여전히 headObject 0회, 서명 URL 폴백 ${N}회(폴백 계약 유지)`, async () => {
    const headObject = jest.fn().mockResolvedValue({ sizeBytes: 1 });
    const prisma = {
      content: { findMany: jest.fn(), findUnique: jest.fn() },
      mediaAsset: { findMany: jest.fn(), findFirst: jest.fn() },
      aiAnalysis: { findMany: jest.fn() },
      station: { findMany: jest.fn() },
    };
    const s3 = { presignGet: jest.fn().mockResolvedValue({ url: 'signed', expiresAt: 'x' }) };
    const service = new FeedService(prisma as never, s3 as never, makeRealPublicMedia(headObject));

    const contents = Array.from({ length: N }, (_, i) =>
      row({ id: `01920000-0000-7000-8000-0000000000${String(i).padStart(2, '0')}` }),
    );
    prisma.content.findMany.mockResolvedValue(contents);
    prisma.mediaAsset.findMany.mockResolvedValue(
      contents.map((c, i) =>
        rendition({
          id: `thumb-${i}`,
          contentId: c.id,
          kind: 'thumbnail',
          storageKey: `contents/${c.id}/g1/thumbnail.jpg`,
        }),
      ),
    );
    prisma.aiAnalysis.findMany.mockResolvedValue([]);

    const page = await service.list(q({ limit: N }));

    expect(page.items.every((it) => it.thumbnailUrl === 'signed')).toBe(true);
    expect(headObject).toHaveBeenCalledTimes(0);
    expect(s3.presignGet).toHaveBeenCalledTimes(N);
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
