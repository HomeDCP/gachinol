import { DomainException } from '../common/errors/domain.exception';
import {
  centerOperatorUser,
  contentRow,
  makePrismaMock,
  reporterUser,
} from '../test-support/fixtures';
import { ContentWorkflowService } from './content-workflow.service';

/** system 액터 전이(applySystemTransition) + 업로드 user 전이(begin/complete/failUpload) */
describe('ContentWorkflowService — system·upload 전이 (media-worker 연동)', () => {
  const setup = (row: ReturnType<typeof contentRow>) => {
    const prisma = makePrismaMock();
    prisma.content.findUnique.mockResolvedValue(row);
    return { prisma, service: new ContentWorkflowService(prisma) };
  };

  const expectDomainError = async (p: Promise<unknown>, code: string) => {
    const err = await p.then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).code).toBe(code);
  };

  describe('applySystemTransition', () => {
    it('uploaded→processing 성공: CAS·로그 actorType=system·jobId 기록, applied=true', async () => {
      const { prisma, service } = setup(contentRow({ status: 'uploaded' }));
      const res = await service.applySystemTransition('c-1', 'uploaded', 'processing', 'job-abc');
      expect(res.applied).toBe(true);
      expect(prisma.content.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c-1', status: 'uploaded' } }),
      );
      const log = prisma.statusTransitionLog.create.mock.calls[0][0].data;
      expect(log).toMatchObject({ actorType: 'system', actorUserId: null, jobId: 'job-abc' });
    });

    it('재전송 멱등: 이미 processing이면 applied=false·updateMany 미호출·로그 0', async () => {
      const { prisma, service } = setup(contentRow({ status: 'processing' }));
      const res = await service.applySystemTransition('c-1', 'uploaded', 'processing', 'job-abc');
      expect(res.applied).toBe(false);
      expect(prisma.content.updateMany).not.toHaveBeenCalled();
      expect(prisma.statusTransitionLog.create).not.toHaveBeenCalled();
    });

    it('CAS count=0(경합)도 throw 없이 applied=false', async () => {
      const { prisma, service } = setup(contentRow({ status: 'uploaded' }));
      prisma.content.updateMany.mockResolvedValue({ count: 0 });
      const res = await service.applySystemTransition('c-1', 'uploaded', 'processing', 'job-abc');
      expect(res.applied).toBe(false);
      expect(prisma.statusTransitionLog.create).not.toHaveBeenCalled();
    });

    it('preview_generating→awaiting_reporter_review는 origin=live_vod면 invalid_transition(가드)', async () => {
      const { service } = setup(
        contentRow({ status: 'preview_generating', origin: 'live_vod', reporterId: null }),
      );
      await expectDomainError(
        service.applySystemTransition('c-1', 'preview_generating', 'awaiting_reporter_review', 'j'),
        'invalid_transition',
      );
    });

    it('origin=reporter_upload면 preview_generating→awaiting_reporter_review 통과(담당 기자 검사 없음)', async () => {
      const { prisma, service } = setup(
        contentRow({ status: 'preview_generating', origin: 'reporter_upload' }),
      );
      const res = await service.applySystemTransition(
        'c-1',
        'preview_generating',
        'awaiting_reporter_review',
        'j',
      );
      expect(res.applied).toBe(true);
      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe('awaiting_reporter_review');
    });

    it('맵 불법 전이(processing→awaiting_reporter_review)는 invalid_transition', async () => {
      const { service } = setup(contentRow({ status: 'processing' }));
      await expectDomainError(
        service.applySystemTransition('c-1', 'processing', 'awaiting_reporter_review', 'j'),
        'invalid_transition',
      );
    });

    it('mutate(lastError)로 실패 사유 기록: processing→processing_failed', async () => {
      const { prisma, service } = setup(contentRow({ status: 'processing' }));
      await service.applySystemTransition('c-1', 'processing', 'processing_failed', 'j', {
        mutate: { lastError: { message: 'ffmpeg 실패', at: 'now' } as never },
      });
      const data = prisma.content.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('processing_failed');
      expect(data.lastError).toMatchObject({ message: 'ffmpeg 실패' });
    });
  });

  describe('beginUpload / completeUpload / failUpload — user 액터, 소유 기자', () => {
    it('beginUpload: draft→uploading (소유 기자)', async () => {
      const { prisma, service } = setup(contentRow({ status: 'draft' }));
      await service.beginUpload('c-1', reporterUser());
      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe('uploading');
    });

    it('beginUpload: upload_failed→uploading (재업로드)', async () => {
      const { prisma, service } = setup(contentRow({ status: 'upload_failed' }));
      await service.beginUpload('c-1', reporterUser());
      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe('uploading');
    });

    it('completeUpload: uploading→uploaded', async () => {
      const { prisma, service } = setup(contentRow({ status: 'uploading' }));
      await service.completeUpload('c-1', reporterUser());
      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe('uploaded');
    });

    it('failUpload: uploading→upload_failed', async () => {
      const { prisma, service } = setup(contentRow({ status: 'uploading' }));
      await service.failUpload('c-1', reporterUser());
      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe('upload_failed');
    });

    it('비소유 기자는 403', async () => {
      const { service } = setup(contentRow({ status: 'draft', reporterId: 'u-other' }));
      await expectDomainError(service.beginUpload('c-1', reporterUser()), 'forbidden');
    });

    it('맵 불법(uploaded에서 beginUpload)은 invalid_transition', async () => {
      const { service } = setup(contentRow({ status: 'uploaded' }));
      await expectDomainError(service.beginUpload('c-1', reporterUser()), 'invalid_transition');
    });
  });

  describe('beginPublishing — 송출 트리거 CAS (센터 액터)', () => {
    it('center_approved→publishing: user 로그 기록', async () => {
      const { prisma, service } = setup(contentRow({ status: 'center_approved' }));
      await service.beginPublishing(prisma, contentRow({ status: 'center_approved' }), centerOperatorUser());
      expect(prisma.content.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c-1', status: 'center_approved' } }),
      );
      const log = prisma.statusTransitionLog.create.mock.calls[0][0].data;
      expect(log).toMatchObject({ actorType: 'user', toStatus: 'publishing' });
    });

    it('경합 count=0 → conflict throw (distribute 1승리)', async () => {
      const { prisma, service } = setup(contentRow({ status: 'center_approved' }));
      prisma.content.updateMany.mockResolvedValue({ count: 0 });
      await expectDomainError(
        service.beginPublishing(prisma, contentRow({ status: 'center_approved' }), centerOperatorUser()),
        'conflict',
      );
    });

    it('기자 액터 → forbidden', async () => {
      const { prisma, service } = setup(contentRow({ status: 'center_approved' }));
      await expectDomainError(
        service.beginPublishing(prisma, contentRow({ status: 'center_approved' }), reporterUser()),
        'forbidden',
      );
    });
  });

  describe('resumePublishing — 채널 재시도 시 content 복귀', () => {
    it('publish_failed→publishing CAS(idempotent)', async () => {
      const { prisma, service } = setup(contentRow({ status: 'publish_failed' }));
      await service.resumePublishing(prisma, contentRow({ status: 'publish_failed' }), centerOperatorUser());
      expect(prisma.content.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c-1', status: 'publish_failed' } }),
      );
    });

    it('이미 publishing이면 skip(무동작)', async () => {
      const { prisma, service } = setup(contentRow({ status: 'publishing' }));
      await service.resumePublishing(prisma, contentRow({ status: 'publishing' }), centerOperatorUser());
      expect(prisma.content.updateMany).not.toHaveBeenCalled();
    });
  });
});
