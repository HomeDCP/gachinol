import { DomainException } from '../common/errors/domain.exception';
import { makePrismaMock, publicationRow } from '../test-support/fixtures';
import { PublicationsService } from './publications.service';

describe('PublicationsService', () => {
  const setup = () => {
    const prisma = makePrismaMock();
    return { prisma, service: new PublicationsService(prisma) };
  };

  describe('createQueued (멱등)', () => {
    it('활성 행 존재 → 재사용(신규 생성 없음)', async () => {
      const { prisma, service } = setup();
      const existing = publicationRow({ id: 'pub-existing' });
      prisma.publication.findFirst.mockResolvedValue(existing);
      const row = await service.createQueued(prisma, {
        contentId: 'c-1',
        channelAccountId: 'ch-aewol',
        platform: 'kakao',
        requestedByUserId: 'u-center',
      });
      expect(row.id).toBe('pub-existing');
      expect(prisma.publication.create).not.toHaveBeenCalled();
    });

    it('활성 행 없음 → queued 생성', async () => {
      const { prisma, service } = setup();
      prisma.publication.findFirst.mockResolvedValue(null);
      prisma.publication.create.mockImplementation(async ({ data }: any) => data);
      const row = await service.createQueued(prisma, {
        contentId: 'c-1',
        channelAccountId: 'ch-aewol',
        platform: 'kakao',
        requestedByUserId: 'u-center',
      });
      expect(prisma.publication.create).toHaveBeenCalled();
      expect(row.status).toBe('queued');
      expect(row.sourceKind).toBe('content');
      expect(row.contentId).toBe('c-1');
      expect(row.liveSessionId).toBeNull();
    });
  });

  describe('beginPublishing (queued→publishing CAS)', () => {
    it('count>0 → true', async () => {
      const { prisma, service } = setup();
      prisma.publication.updateMany.mockResolvedValue({ count: 1 });
      expect(await service.beginPublishing('pub-1')).toBe(true);
      expect(prisma.publication.updateMany).toHaveBeenCalledWith({
        where: { id: 'pub-1', status: 'queued' },
        data: { status: 'publishing', attempts: { increment: 1 } },
      });
    });

    it('count=0(이미 publishing/종결) → false(no-op)', async () => {
      const { prisma, service } = setup();
      prisma.publication.updateMany.mockResolvedValue({ count: 0 });
      expect(await service.beginPublishing('pub-1')).toBe(false);
    });
  });

  describe('resolveResult', () => {
    it('ok → publishing 후 published(+extPostId/Url/publishedAt)', async () => {
      const { prisma, service } = setup();
      await service.resolveResult({
        publicationId: 'pub-1' as never,
        ok: true,
        externalPostId: 'kakao_mock_pub-1',
        externalUrl: 'https://pf.kakao.com/kakao-aewol/kakao_mock_pub-1',
      });
      // 마지막 updateMany가 published 전이
      const calls = prisma.publication.updateMany.mock.calls;
      const publishedCall = calls.find((c: any[]) => c[0].data.status === 'published');
      expect(publishedCall).toBeDefined();
      expect(publishedCall[0].where).toEqual({ id: 'pub-1', status: 'publishing' });
      expect(publishedCall[0].data.externalPostId).toBe('kakao_mock_pub-1');
      expect(publishedCall[0].data.publishedAt).toBeInstanceOf(Date);
    });

    it('!ok → publishing 후 failed(+errorMessage)', async () => {
      const { prisma, service } = setup();
      await service.resolveResult({ publicationId: 'pub-1' as never, ok: false, error: '카카오 실패' });
      const calls = prisma.publication.updateMany.mock.calls;
      const failedCall = calls.find((c: any[]) => c[0].data.status === 'failed');
      expect(failedCall).toBeDefined();
      expect(failedCall[0].data.errorMessage).toBe('카카오 실패');
    });
  });

  describe('summarizeForContent', () => {
    const mockStatuses = (prisma: any, statuses: string[]) =>
      prisma.publication.findMany.mockResolvedValue(statuses.map((status) => ({ status })));

    it('전부 published → allPublished', async () => {
      const { prisma, service } = setup();
      mockStatuses(prisma, ['published', 'published']);
      expect(await service.summarizeForContent('c-1')).toEqual({
        anyPending: false,
        anyFailed: false,
        allPublished: true,
      });
    });

    it('일부 failed·나머지 published → anyFailed·!anyPending', async () => {
      const { prisma, service } = setup();
      mockStatuses(prisma, ['published', 'failed']);
      const s = await service.summarizeForContent('c-1');
      expect(s.anyFailed).toBe(true);
      expect(s.anyPending).toBe(false);
      expect(s.allPublished).toBe(false);
    });

    it('queued/publishing 존재 → anyPending', async () => {
      const { prisma, service } = setup();
      mockStatuses(prisma, ['publishing', 'published']);
      const s = await service.summarizeForContent('c-1');
      expect(s.anyPending).toBe(true);
      expect(s.allPublished).toBe(false);
    });

    it('관련 행 0 → 전부 false', async () => {
      const { prisma, service } = setup();
      mockStatuses(prisma, []);
      expect(await service.summarizeForContent('c-1')).toEqual({
        anyPending: false,
        anyFailed: false,
        allPublished: false,
      });
    });
  });

  describe('retryToQueued / retract — 전이맵 검증', () => {
    it('retryToQueued: failed→queued 합법 CAS', async () => {
      const { prisma, service } = setup();
      prisma.publication.updateMany.mockResolvedValue({ count: 1 });
      expect(await service.retryToQueued(prisma, 'pub-1', 'failed')).toBe(true);
    });

    it('retryToQueued: published→queued 불법 → invalid_transition', async () => {
      const { service, prisma } = setup();
      const err = await service.retryToQueued(prisma, 'pub-1', 'published').then(
        () => null,
        (e) => e,
      );
      expect(err).toBeInstanceOf(DomainException);
      expect((err as DomainException).code).toBe('invalid_transition');
    });

    it('retract: published→retracted CAS(+retractedAt)', async () => {
      const { prisma, service } = setup();
      prisma.publication.updateMany.mockResolvedValue({ count: 1 });
      expect(await service.retract(prisma, 'pub-1')).toBe(true);
      const call = prisma.publication.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'pub-1', status: 'published' });
      expect(call.data.status).toBe('retracted');
      expect(call.data.retractedAt).toBeInstanceOf(Date);
    });
  });
});
