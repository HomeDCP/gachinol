import { DomainException } from '../common/errors/domain.exception';
import {
  centerOperatorUser,
  channelAccountRow,
  contentRow,
  makePrismaMock,
  publicationRow,
  reporterUser,
} from '../test-support/fixtures';
import { DistributionOrchestratorService } from './distribution-orchestrator.service';

const expectCode = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(DomainException);
  expect((err as DomainException).code).toBe(code);
};

const setup = () => {
  const prisma = makePrismaMock();
  const workflow = {
    beginPublishing: jest.fn().mockResolvedValue(undefined),
    resumePublishing: jest.fn().mockResolvedValue(undefined),
  };
  const publications = {
    createQueued: jest
      .fn()
      .mockImplementation(async (_tx, p) =>
        publicationRow({ ...p, id: `pub-${p.channelAccountId}` }),
      ),
    listForContent: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(publicationRow()),
    retryToQueued: jest.fn().mockResolvedValue(true),
    retract: jest.fn().mockResolvedValue(true),
  };
  const channels = {
    resolveTargets: jest.fn().mockResolvedValue([channelAccountRow()]),
    findById: jest.fn().mockResolvedValue(channelAccountRow()),
  };
  const producer = { enqueuePublish: jest.fn().mockResolvedValue(undefined) };
  const registry = {
    get: jest.fn().mockReturnValue({ retract: jest.fn().mockResolvedValue(undefined) }),
  };
  const service = new DistributionOrchestratorService(
    prisma,
    workflow as never,
    publications as never,
    channels as never,
    producer as never,
    registry as never,
  );
  return { prisma, workflow, publications, channels, producer, registry, service };
};

describe('DistributionOrchestratorService', () => {
  describe('distribute', () => {
    it('center_approved: beginPublishing CAS + 채널별 Publication + 커밋 후 인큐', async () => {
      const { prisma, workflow, publications, producer, service } = setup();
      prisma.content.findUnique.mockResolvedValue(contentRow({ status: 'center_approved' }));
      const out = await service.distribute('c-1', centerOperatorUser());
      expect(workflow.beginPublishing).toHaveBeenCalled();
      expect(publications.createQueued).toHaveBeenCalledTimes(1);
      expect(producer.enqueuePublish).toHaveBeenCalled();
      expect(out).toHaveLength(1);
      expect(out[0]!.source).toEqual({ kind: 'content', contentId: 'c-1' });
    });

    it('비center_approved → conflict', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(contentRow({ status: 'awaiting_center_review' }));
      await expectCode(service.distribute('c-1', centerOperatorUser()), 'conflict');
    });

    it('기자 → forbidden', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(contentRow({ status: 'center_approved' }));
      await expectCode(service.distribute('c-1', reporterUser()), 'forbidden');
    });

    it('대상 채널 0 → conflict(resolveTargets)', async () => {
      const { prisma, channels, service } = setup();
      prisma.content.findUnique.mockResolvedValue(contentRow({ status: 'center_approved' }));
      channels.resolveTargets.mockRejectedValue(
        new DomainException('conflict', '송출 대상 채널이 없습니다'),
      );
      await expectCode(service.distribute('c-1', centerOperatorUser()), 'conflict');
    });

    it('없는 콘텐츠 → not_found', async () => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(null);
      await expectCode(service.distribute('c-x', centerOperatorUser()), 'not_found');
    });
  });

  describe('retryPublication', () => {
    it('failed → queued 재큐 + content resumePublishing', async () => {
      const { prisma, publications, workflow, producer, service } = setup();
      publications.findById.mockResolvedValue(publicationRow({ status: 'failed' }));
      prisma.content.findUnique.mockResolvedValue(contentRow({ status: 'publish_failed' }));
      await service.retryPublication('pub-1', centerOperatorUser());
      expect(publications.retryToQueued).toHaveBeenCalledWith(expect.anything(), 'pub-1', 'failed');
      expect(workflow.resumePublishing).toHaveBeenCalled();
      expect(producer.enqueuePublish).toHaveBeenCalled();
    });

    it('failed 아님 → conflict', async () => {
      const { publications, service } = setup();
      publications.findById.mockResolvedValue(publicationRow({ status: 'published' }));
      await expectCode(service.retryPublication('pub-1', centerOperatorUser()), 'conflict');
    });
  });

  describe('startAutoDistribution (reporter_only 자동 송출)', () => {
    it('publishing 콘텐츠 → 담당 기자 액터로 채널별 Publication 생성 + 커밋 후 인큐(센터 가드 없음)', async () => {
      const { prisma, publications, producer, workflow, service } = setup();
      const publishing = contentRow({ status: 'publishing' });
      prisma.content.findUnique.mockResolvedValue(publishing);
      const reporter = reporterUser();

      const out = await service.startAutoDistribution(publishing, reporter);

      // content 전이 재수행 없음(approve가 이미 publishing으로 옮김)
      expect(workflow.beginPublishing).not.toHaveBeenCalled();
      expect(publications.createQueued).toHaveBeenCalledTimes(1);
      // 담당 기자 액터 — requestedByUserId=reporter.id
      expect(publications.createQueued).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ requestedByUserId: reporter.id }),
      );
      expect(producer.enqueuePublish).toHaveBeenCalled();
      expect(out).toHaveLength(1);
    });

    it('publishing 아님 → no-op(재수행·인큐 없음)', async () => {
      const { publications, producer, service } = setup();
      const out = await service.startAutoDistribution(
        contentRow({ status: 'center_approved' }),
        reporterUser(),
      );
      expect(out).toEqual([]);
      expect(publications.createQueued).not.toHaveBeenCalled();
      expect(producer.enqueuePublish).not.toHaveBeenCalled();
    });

    it('대상 채널 0건(resolveTargets conflict) → 경고 후 no-op(throw 없음, publishing 유지)', async () => {
      const { channels, publications, producer, service } = setup();
      channels.resolveTargets.mockRejectedValue(
        new DomainException('conflict', '송출 대상 채널이 없습니다'),
      );
      const out = await service.startAutoDistribution(
        contentRow({ status: 'publishing' }),
        reporterUser(),
      );
      expect(out).toEqual([]);
      expect(publications.createQueued).not.toHaveBeenCalled();
      expect(producer.enqueuePublish).not.toHaveBeenCalled();
    });
  });

  describe('retractPublication', () => {
    it('published → adapter.retract + retracted CAS', async () => {
      const { publications, registry, service } = setup();
      const retract = jest.fn().mockResolvedValue(undefined);
      registry.get.mockReturnValue({ retract });
      publications.findById.mockResolvedValue(
        publicationRow({ status: 'published', externalPostId: 'p1' }),
      );
      await service.retractPublication('pub-1', centerOperatorUser());
      expect(retract).toHaveBeenCalled();
      expect(publications.retract).toHaveBeenCalled();
    });

    it('published 아님 → conflict', async () => {
      const { publications, service } = setup();
      publications.findById.mockResolvedValue(publicationRow({ status: 'queued' }));
      await expectCode(service.retractPublication('pub-1', centerOperatorUser()), 'conflict');
    });
  });
});
