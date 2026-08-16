import type { MediaAsset as MediaAssetRow } from '@prisma/client';
import { PUBLIC_MEDIA_CACHE_CONTROL, PublicMediaService } from './public-media.service';

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
    // 공개 사본 기록(T-W2-33) — 기본은 "사본 모름"(마이그레이션 직후 기존 행과 동일)
    publicBucket: null,
    publicKey: null,
    publicCopiedAt: null,
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
  const prisma = {
    mediaAsset: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
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
        asset({
          id: 'thumb-1',
          kind: 'thumbnail',
          storageKey: 'contents/c-1/g1/thumbnail.jpg',
          mimeType: 'image/jpeg',
        }),
        asset({ id: 'r-720', renditionLabel: '720p', storageKey: 'contents/c-1/g1/rendition/720p.mp4' }),
      ]);

      await service.syncPublishedCopies('c-1', 1);

      expect(s3.copyObject).toHaveBeenCalledWith({
        sourceBucket: 'gachinol-media',
        sourceKey: 'contents/c-1/g1/rendition/720p.mp4',
        destBucket: 'gachinol-media',
        destKey: 'public/contents/c-1/g1/rendition/720p.mp4',
        cacheControl: PUBLIC_MEDIA_CACHE_CONTROL,
        contentType: 'video/mp4',
      });
      expect(s3.copyObject).toHaveBeenCalledWith({
        sourceBucket: 'gachinol-media',
        sourceKey: 'contents/c-1/g1/thumbnail.jpg',
        destBucket: 'gachinol-media',
        destKey: 'public/contents/c-1/g1/thumbnail.jpg',
        cacheControl: PUBLIC_MEDIA_CACHE_CONTROL,
        contentType: 'image/jpeg',
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

    // ── T-W2-33: 공개 사본 위치를 DB에 기록(피드의 HEAD 판정 대체) ──────────────────────
    it('복사 성공 → 그 자산 행에 공개 사본 위치(bucket/key/copiedAt)를 기록한다', async () => {
      const { prisma, s3, service } = makeSetupPublicEnabled({
        MEDIA_PUBLIC_BUCKET: 'gachinol-media-public',
      });
      prisma.mediaAsset.findMany.mockResolvedValue([asset({ id: 'r-720' })]);

      await service.syncPublishedCopies('c-1', 1);

      expect(s3.copyObject).toHaveBeenCalledTimes(1);
      expect(prisma.mediaAsset.update).toHaveBeenCalledTimes(1);
      const arg = prisma.mediaAsset.update.mock.calls[0]![0] as {
        where: { id: string };
        data: { publicBucket: string; publicKey: string; publicCopiedAt: Date };
      };
      expect(arg.where).toEqual({ id: 'r-720' });
      expect(arg.data.publicBucket).toBe('gachinol-media-public');
      expect(arg.data.publicKey).toBe('public/contents/c-1/g1/rendition/720p.mp4');
      expect(arg.data.publicCopiedAt).toBeInstanceOf(Date);
    });

    it('복사 실패한 자산은 기록하지 않는다(부분 실패 = 자산 단위) — 성공한 자산만 기록', async () => {
      const { prisma, s3, service } = makeSetupPublicEnabled();
      prisma.mediaAsset.findMany.mockResolvedValue([
        asset({ id: 'thumb-1', kind: 'thumbnail', storageKey: 'contents/c-1/g1/thumbnail.jpg' }),
        asset({ id: 'r-720' }),
      ]);
      // selectPublicAssets는 [렌디션, 썸네일] 순으로 돌려주므로 첫 복사=r-720(실패), 둘째=thumb-1(성공)
      s3.copyObject.mockRejectedValueOnce(new Error('S3 down')).mockResolvedValueOnce(undefined);

      await service.syncPublishedCopies('c-1', 1);

      expect(prisma.mediaAsset.update).toHaveBeenCalledTimes(1);
      expect(prisma.mediaAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'thumb-1' } }),
      );
      // "없다"로 남아야 서명 URL 폴백이 걸린다 — 실패한 자산을 기록하면 404 URL을 내주게 된다
      expect(prisma.mediaAsset.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'r-720' } }),
      );
    });

    it('기록 쓰기 자체가 실패해도 throw하지 않는다(사본은 있고 폴백만 걸린다)', async () => {
      const { prisma, service } = makeSetupPublicEnabled();
      prisma.mediaAsset.findMany.mockResolvedValue([asset()]);
      prisma.mediaAsset.update.mockRejectedValue(new Error('DB down'));

      await expect(service.syncPublishedCopies('c-1', 1)).resolves.toBeUndefined();
    });

    it('공개 서빙이 꺼져 있으면 기록도 만들지 않는다(복사 자체를 안 하므로)', async () => {
      const { prisma, service } = makeSetup(); // MEDIA_PUBLIC_BASE_URL 미설정
      prisma.mediaAsset.findMany.mockResolvedValue([asset()]);

      await service.syncPublishedCopies('c-1', 1);

      expect(prisma.mediaAsset.update).not.toHaveBeenCalled();
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

    // ── T-W2-33: 기록 해제(만들기·지우기 대칭). 이게 빠지면 DB가 "사본 있음"이라고 거짓말한다 ──
    it('공개 사본 기록을 비운다 — 그것도 오브젝트를 지우기 "전에"(중간 사망 시 보수적으로 남도록)', async () => {
      const { prisma, s3, service } = makeSetup({
        MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
      });
      const order: string[] = [];
      prisma.mediaAsset.findMany.mockResolvedValue([
        asset({
          id: 'r-720',
          publicBucket: 'gachinol-media',
          publicKey: 'public/contents/c-1/g1/rendition/720p.mp4',
          publicCopiedAt: new Date('2026-07-02T00:00:00.000Z'),
        }),
      ]);
      prisma.mediaAsset.updateMany.mockImplementation(async () => {
        order.push('db:clear');
        return { count: 1 };
      });
      s3.deleteObject.mockImplementation(async () => {
        order.push('s3:delete');
      });

      await service.removePublishedCopies('c-1', 1);

      expect(prisma.mediaAsset.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['r-720'] } },
        data: { publicBucket: null, publicKey: null, publicCopiedAt: null },
      });
      expect(order).toEqual(['db:clear', 's3:delete']);
    });

    it('기록된 실제 위치를 지운다 — 현행 설정으로 파생한 키가 아니라(프리픽스가 바뀌어도 고아 안 남김)', async () => {
      const { prisma, s3, cfCache, service } = makeSetup({
        MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
        MEDIA_PUBLIC_PREFIX: 'public-v2', // 사본을 만든 뒤 프리픽스가 바뀐 상황
      });
      prisma.mediaAsset.findMany.mockResolvedValue([
        asset({
          publicBucket: 'legacy-public-bucket',
          publicKey: 'public-v1/contents/c-1/g1/rendition/720p.mp4',
        }),
      ]);

      await service.removePublishedCopies('c-1', 1);

      expect(s3.deleteObject).toHaveBeenCalledWith(
        'public-v1/contents/c-1/g1/rendition/720p.mp4',
        { bucket: 'legacy-public-bucket' },
      );
      expect(cfCache.purge).toHaveBeenCalledWith([
        'https://media.example.com/public-v1/contents/c-1/g1/rendition/720p.mp4',
      ]);
    });

    it('기록이 없으면(마이그레이션 이전 사본) 현행 설정 파생 키로 폴백해 정리한다', async () => {
      const { prisma, s3, service } = makeSetup({
        MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
      });
      prisma.mediaAsset.findMany.mockResolvedValue([asset()]); // publicKey=null

      await service.removePublishedCopies('c-1', 1);

      expect(s3.deleteObject).toHaveBeenCalledWith('public/contents/c-1/g1/rendition/720p.mp4', {
        bucket: 'gachinol-media',
      });
    });

    it('기록 해제 실패해도 삭제·퍼지는 계속한다(비공개 전환은 규제 요구라 우선)', async () => {
      const { prisma, s3, cfCache, service } = makeSetup({
        MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
      });
      prisma.mediaAsset.findMany.mockResolvedValue([asset()]);
      prisma.mediaAsset.updateMany.mockRejectedValue(new Error('DB down'));

      await expect(service.removePublishedCopies('c-1', 1)).resolves.toBeUndefined();
      expect(s3.deleteObject).toHaveBeenCalledTimes(1);
      expect(cfCache.purge).toHaveBeenCalledTimes(1);
    });

    it('대상 자산 0건이면 기록 해제도 하지 않고 빈 퍼지만 호출한다', async () => {
      const { prisma, s3, cfCache, service } = makeSetup();
      prisma.mediaAsset.findMany.mockResolvedValue([]);

      await service.removePublishedCopies('c-1', 1);

      expect(prisma.mediaAsset.updateMany).not.toHaveBeenCalled();
      expect(s3.deleteObject).not.toHaveBeenCalled();
      expect(cfCache.purge).toHaveBeenCalledWith([]);
    });
  });

  describe('publicUrlForAsset — FeedService 소비용(DB 기록만 본다, S3 왕복 0회)', () => {
    const copied = (over: Partial<MediaAssetRow> = {}) =>
      asset({
        publicBucket: 'gachinol-media',
        publicKey: 'public/contents/c-1/g1/rendition/720p.mp4',
        publicCopiedAt: new Date('2026-07-02T00:00:00.000Z'),
        ...over,
      });

    it('MEDIA_PUBLIC_BASE_URL 미설정 → null (기록이 있어도)', () => {
      const { s3, service } = makeSetup();
      expect(service.publicUrlForAsset(copied())).toBeNull();
      expect(s3.headObject).not.toHaveBeenCalled();
    });

    it('설정 + 기록 있음 → 공개 URL 반환. **headObject를 호출하지 않는다**(대장 #129 ⓐ 해소)', () => {
      const { s3, service } = makeSetup({ MEDIA_PUBLIC_BASE_URL: 'https://media.example.com/' });

      const url = service.publicUrlForAsset(copied());

      expect(url).toBe('https://media.example.com/public/contents/c-1/g1/rendition/720p.mp4');
      expect(s3.headObject).not.toHaveBeenCalled(); // 변경 전에는 자산당 1회씩 호출됐다
    });

    it('기록 없음(아직 미복사·복사 실패·마이그레이션 이전) → null(호출부는 서명 URL로 폴백해야 함)', () => {
      const { service } = makeSetup({ MEDIA_PUBLIC_BASE_URL: 'https://media.example.com' });
      expect(service.publicUrlForAsset(asset())).toBeNull(); // publicKey=null
    });

    it('기록된 버킷 ≠ 현행 공개 버킷 → null (베이스 URL은 지금의 공개 버킷만 가리키므로 404 방지)', () => {
      const { service } = makeSetup({
        MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
        MEDIA_PUBLIC_BUCKET: 'gachinol-media-public',
      });
      expect(service.publicUrlForAsset(copied({ publicBucket: 'legacy-bucket' }))).toBeNull();
    });

    it('기록된 키를 그대로 쓴다 — 현행 프리픽스로 다시 파생하지 않는다', () => {
      const { service } = makeSetup({
        MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
        MEDIA_PUBLIC_PREFIX: 'public-v2',
      });
      expect(service.publicUrlForAsset(copied({ publicKey: 'public-v1/a.mp4' }))).toBe(
        'https://media.example.com/public-v1/a.mp4',
      );
    });
  });
});
