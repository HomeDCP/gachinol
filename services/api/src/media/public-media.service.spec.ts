import type { MediaAsset as MediaAssetRow } from '@prisma/client';
import { PublicMediaService } from './public-media.service';

const asset = (over: Partial<MediaAssetRow> = {}): MediaAssetRow =>
  ({
    id: 'a-1',
    ownerKind: 'content',
    contentId: 'c-1',
    kind: 'rendition',
    status: 'ready',
    generation: 1,
    bucket: 'gachinol-media',
    storageKey: 'contents/c-1/g1/rendition/720p.mp4',
    mimeType: 'video/mp4',
    sizeBytes: null,
    durationSec: 100,
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

const makeConfig = (over: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    MEDIA_PUBLIC_BUCKET: undefined,
    MEDIA_PUBLIC_PREFIX: 'public',
    MEDIA_PUBLIC_BASE_URL: undefined,
    ...over,
  };
  return { get: (k: string) => values[k] } as never;
};

const makeSetup = (configOver: Record<string, unknown> = {}) => {
  const prisma = { mediaAsset: { findMany: jest.fn().mockResolvedValue([]) } };
  const s3 = {
    bucket: 'gachinol-media',
    copyObject: jest.fn().mockResolvedValue(undefined),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    headObject: jest.fn().mockResolvedValue(null),
  };
  const cfCache = { purge: jest.fn().mockResolvedValue({ attempted: false, success: false }) };
  const service = new PublicMediaService(
    prisma as never,
    s3 as never,
    cfCache as never,
    makeConfig(configOver),
  );
  return { prisma, s3, cfCache, service };
};

/** syncPublishedCopies 전용 — 공개 서빙 활성(MEDIA_PUBLIC_BASE_URL 설정) 상태의 기본 setup */
const makeSetupPublicEnabled = (configOver: Record<string, unknown> = {}) =>
  makeSetup({ MEDIA_PUBLIC_BASE_URL: 'https://media.example.com', ...configOver });

describe('PublicMediaService', () => {
  describe('syncPublishedCopies — 발행 시점 공개 복사(D-T8)', () => {
    it('MEDIA_PUBLIC_BASE_URL 미설정(현행 제온 운영 기본값) → 복사하지 않는다(보강2, 조용한 no-op 금지)', async () => {
      const { prisma, s3, service } = makeSetup(); // 기본 setup = MEDIA_PUBLIC_BASE_URL 미설정
      prisma.mediaAsset.findMany.mockResolvedValue([asset()]);

      await service.syncPublishedCopies('c-1', 1);

      expect(s3.copyObject).not.toHaveBeenCalled();
      // 게이트에서 바로 return하므로 DB 조회조차 하지 않는다 — 불필요 쿼리 0
      expect(prisma.mediaAsset.findMany).not.toHaveBeenCalled();
    });

    it('720p 렌디션 + 썸네일을 공개 버킷(기본=S3_BUCKET)·프리픽스로 복사한다', async () => {
      const { prisma, s3, service } = makeSetupPublicEnabled();
      prisma.mediaAsset.findMany.mockResolvedValue([
        asset({ id: 'thumb-1', kind: 'thumbnail', storageKey: 'contents/c-1/g1/thumbnail.jpg' }),
        asset({ id: 'r-720', renditionLabel: '720p', storageKey: 'contents/c-1/g1/rendition/720p.mp4' }),
      ]);

      await service.syncPublishedCopies('c-1', 1);

      expect(s3.copyObject).toHaveBeenCalledWith({
        sourceBucket: 'gachinol-media',
        sourceKey: 'contents/c-1/g1/rendition/720p.mp4',
        destBucket: 'gachinol-media',
        destKey: 'public/contents/c-1/g1/rendition/720p.mp4',
      });
      expect(s3.copyObject).toHaveBeenCalledWith({
        sourceBucket: 'gachinol-media',
        sourceKey: 'contents/c-1/g1/thumbnail.jpg',
        destBucket: 'gachinol-media',
        destKey: 'public/contents/c-1/g1/thumbnail.jpg',
      });
      expect(s3.copyObject).toHaveBeenCalledTimes(2);
    });

    it('MEDIA_PUBLIC_BUCKET 설정 시 그 버킷을 목적지로 쓴다(원본 버킷과 분리)', async () => {
      const { prisma, s3, service } = makeSetupPublicEnabled({
        MEDIA_PUBLIC_BUCKET: 'gachinol-media-public',
      });
      prisma.mediaAsset.findMany.mockResolvedValue([asset()]);

      await service.syncPublishedCopies('c-1', 1);

      expect(s3.copyObject).toHaveBeenCalledWith(
        expect.objectContaining({ destBucket: 'gachinol-media-public' }),
      );
    });

    it('720p 라벨이 없으면 findMany 반환 순서상 첫 렌디션으로 폴백(더 오래된 480p가 아니라 최신 1080p, feed 선택 로직과 동일)', async () => {
      const { prisma, s3, service } = makeSetupPublicEnabled();
      // 실 쿼리는 orderBy: createdAt desc — 목도 그 순서를 그대로 흉내낸다(최신이 배열 첫 항목).
      // 두 렌디션을 모두 줘서 "유일해서 골랐다"가 아니라 "첫 항목을 골랐다"를 실제로 가른다(보강4 ①).
      prisma.mediaAsset.findMany.mockResolvedValue([
        asset({
          id: 'r-1080',
          renditionLabel: '1080p',
          storageKey: 'contents/c-1/g1/rendition/1080p.mp4',
          createdAt: new Date('2026-07-02T00:00:00.000Z'), // 더 최신 — desc 정렬상 배열 첫 항목
        }),
        asset({
          id: 'r-480',
          renditionLabel: '480p',
          storageKey: 'contents/c-1/g1/rendition/480p.mp4',
          createdAt: new Date('2026-07-01T00:00:00.000Z'), // 더 오래됨 — 배열 둘째 항목
        }),
      ]);

      await service.syncPublishedCopies('c-1', 1);

      // 둘째 항목(480p)은 절대 복사 대상이 아니어야 한다 — "유일해서"가 아니라 "첫째라서" 골랐음을 증명
      expect(s3.copyObject).not.toHaveBeenCalledWith(
        expect.objectContaining({ sourceKey: 'contents/c-1/g1/rendition/480p.mp4' }),
      );

      expect(s3.copyObject).toHaveBeenCalledWith(
        expect.objectContaining({ sourceKey: 'contents/c-1/g1/rendition/1080p.mp4' }),
      );
    });

    it('개별 자산 복사 실패는 삼키고(throw 없음) 다른 자산 복사를 막지 않는다', async () => {
      const { prisma, s3, service } = makeSetupPublicEnabled();
      prisma.mediaAsset.findMany.mockResolvedValue([
        asset({ id: 'thumb-1', kind: 'thumbnail', storageKey: 'contents/c-1/g1/thumbnail.jpg' }),
        asset({ id: 'r-720' }),
      ]);
      s3.copyObject.mockRejectedValueOnce(new Error('S3 down')).mockResolvedValueOnce(undefined);

      await expect(service.syncPublishedCopies('c-1', 1)).resolves.toBeUndefined();
      expect(s3.copyObject).toHaveBeenCalledTimes(2);
    });

    it('공개 서빙은 켜져 있으나(게이트 통과) 대상 자산이 없으면(아직 ready 렌디션 없음) 아무것도 복사하지 않는다', async () => {
      const { prisma, s3, service } = makeSetupPublicEnabled();
      prisma.mediaAsset.findMany.mockResolvedValue([]);

      await service.syncPublishedCopies('c-1', 1);

      // 게이트는 통과했으므로(위 no-op 테스트와 대비) DB 조회는 실제로 일어난다 — 대상만 0건
      expect(prisma.mediaAsset.findMany).toHaveBeenCalledTimes(1);
      expect(s3.copyObject).not.toHaveBeenCalled();
    });
  });

  describe('removePublishedCopies — 삭제·비공개 전환 시 필수 대칭(D-T8)', () => {
    it('공개 복사본을 제거하고 CF 캐시 퍼지를 호출한다(공개 URL 구성 가능할 때)', async () => {
      const { prisma, s3, cfCache, service } = makeSetup({
        MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
      });
      prisma.mediaAsset.findMany.mockResolvedValue([asset()]);

      await service.removePublishedCopies('c-1', 1);

      expect(s3.deleteObject).toHaveBeenCalledWith('public/contents/c-1/g1/rendition/720p.mp4', {
        bucket: 'gachinol-media',
      });
      expect(cfCache.purge).toHaveBeenCalledWith([
        'https://media.example.com/public/contents/c-1/g1/rendition/720p.mp4',
      ]);
    });

    it('MEDIA_PUBLIC_BASE_URL 미설정이어도 객체 제거는 시도하고, 퍼지는 빈 목록으로 호출한다', async () => {
      const { prisma, s3, cfCache, service } = makeSetup();
      prisma.mediaAsset.findMany.mockResolvedValue([asset()]);

      await service.removePublishedCopies('c-1', 1);

      expect(s3.deleteObject).toHaveBeenCalledTimes(1);
      expect(cfCache.purge).toHaveBeenCalledWith([]);
    });

    it('개별 자산 제거 실패는 삼키고(throw 없음) 그래도 퍼지를 호출한다', async () => {
      const { prisma, s3, cfCache, service } = makeSetup({
        MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
      });
      prisma.mediaAsset.findMany.mockResolvedValue([asset()]);
      s3.deleteObject.mockRejectedValue(new Error('S3 down'));

      await expect(service.removePublishedCopies('c-1', 1)).resolves.toBeUndefined();
      expect(cfCache.purge).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolvePublicUrl — FeedService 소비용', () => {
    it('MEDIA_PUBLIC_BASE_URL 미설정 → HEAD 없이 즉시 null', async () => {
      const { s3, service } = makeSetup();
      const url = await service.resolvePublicUrl('contents/c-1/g1/rendition/720p.mp4');
      expect(url).toBeNull();
      expect(s3.headObject).not.toHaveBeenCalled();
    });

    it('설정 + HEAD 성공 → 공개 URL 반환', async () => {
      const { s3, service } = makeSetup({ MEDIA_PUBLIC_BASE_URL: 'https://media.example.com/' });
      s3.headObject.mockResolvedValue({ sizeBytes: 123 });

      const url = await service.resolvePublicUrl('contents/c-1/g1/rendition/720p.mp4');

      expect(s3.headObject).toHaveBeenCalledWith('public/contents/c-1/g1/rendition/720p.mp4', {
        bucket: 'gachinol-media',
      });
      expect(url).toBe('https://media.example.com/public/contents/c-1/g1/rendition/720p.mp4');
    });

    it('설정됐지만 HEAD 부재(아직 미복사·복사 실패) → null(호출부는 서명 URL로 폴백해야 함)', async () => {
      const { s3, service } = makeSetup({ MEDIA_PUBLIC_BASE_URL: 'https://media.example.com' });
      s3.headObject.mockResolvedValue(null);

      const url = await service.resolvePublicUrl('contents/c-1/g1/rendition/720p.mp4');
      expect(url).toBeNull();
    });
  });
});
