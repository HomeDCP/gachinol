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

    describe('공개 렌디션 캐시 서빙 훅 (D-T8, T-W2-10) — PipelineService.onPublishCompleted 정상계', () => {
      const setupWithPublicMedia = (row: ReturnType<typeof contentRow>) => {
        const prisma = makePrismaMock();
        prisma.content.findUnique.mockResolvedValue(row);
        const publicMedia = { syncPublishedCopies: jest.fn().mockResolvedValue(undefined) };
        const service = new ContentWorkflowService(prisma, publicMedia as never);
        return { prisma, publicMedia, service };
      };

      it('publishing→published 성공(applied=true) → syncPublishedCopies(contentId, generation) 호출, DB 커밋 후 순서', async () => {
        const row = contentRow({ status: 'publishing', publishedAt: null, generation: 4 });
        const { prisma, publicMedia, service } = setupWithPublicMedia(row);

        // 순서 검증(보강4 ②) — $transaction 목이 콜백을 즉시 await하므로 시간차로는 "커밋 후"를
        // 구분할 수 없다. 호출 시퀀스로 "DB 쓰기(applyHop 내부)가 먼저, 훅이 나중"을 직접 증명한다.
        const callOrder: string[] = [];
        prisma.content.updateMany.mockImplementation(async () => {
          callOrder.push('db:updateMany');
          return { count: 1 };
        });
        publicMedia.syncPublishedCopies.mockImplementation(async () => {
          callOrder.push('hook:syncPublishedCopies');
        });

        const res = await service.applySystemTransition('c-1', 'publishing', 'published', 'job-x');

        expect(res.applied).toBe(true);
        expect(publicMedia.syncPublishedCopies).toHaveBeenCalledWith('c-1', 4);
        expect(callOrder).toEqual(['db:updateMany', 'hook:syncPublishedCopies']);
      });

      it('재전송 멱등(applied=false)이면 재복사하지 않는다(불필요 I/O 방지)', async () => {
        // 이미 published인 상태에서 재수신(reconcileDistributionPending 재시도 등)
        const row = contentRow({ status: 'published', generation: 4 });
        const { publicMedia, service } = setupWithPublicMedia(row);

        const res = await service.applySystemTransition('c-1', 'publishing', 'published', 'job-x');

        expect(res.applied).toBe(false);
        expect(publicMedia.syncPublishedCopies).not.toHaveBeenCalled();
      });

      it('published가 아닌 다른 to는 훅을 호출하지 않는다(예: uploaded→processing)', async () => {
        const row = contentRow({ status: 'uploaded' });
        const { publicMedia, service } = setupWithPublicMedia(row);

        await service.applySystemTransition('c-1', 'uploaded', 'processing', 'job-x');

        expect(publicMedia.syncPublishedCopies).not.toHaveBeenCalled();
      });
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

  describe('failUploadTx — 업로드 실패 트랜잭션 버전 (대장 #168)', () => {
    it('uploading→upload_failed: user 로그 기록 (beginPublishing과 동형 — 호출자 tx 사용)', async () => {
      const { prisma, service } = setup(contentRow({ status: 'uploading' }));
      await service.failUploadTx(prisma, contentRow({ status: 'uploading' }), reporterUser());
      expect(prisma.content.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c-1', status: 'uploading' } }),
      );
      const log = prisma.statusTransitionLog.create.mock.calls[0][0].data;
      expect(log).toMatchObject({ actorType: 'user', toStatus: 'upload_failed' });
    });

    it('failUpload(비트랜잭션)과 동일한 CAS where절 — 두 경로가 같은 규칙을 탄다', async () => {
      const { prisma, service } = setup(contentRow({ status: 'uploading' }));
      await service.failUploadTx(prisma, contentRow({ status: 'uploading' }), reporterUser());
      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe('upload_failed');
    });

    it('비소유 기자는 403 — DB를 치지 않는다', async () => {
      const { prisma, service } = setup(contentRow({ status: 'uploading', reporterId: 'u-other' }));
      await expectDomainError(
        service.failUploadTx(
          prisma,
          contentRow({ status: 'uploading', reporterId: 'u-other' }),
          reporterUser(),
        ),
        'forbidden',
      );
      expect(prisma.content.updateMany).not.toHaveBeenCalled();
    });

    it('맵 불법(uploaded에서 failUploadTx)은 invalid_transition', async () => {
      const { prisma, service } = setup(contentRow({ status: 'uploaded' }));
      await expectDomainError(
        service.failUploadTx(prisma, contentRow({ status: 'uploaded' }), reporterUser()),
        'invalid_transition',
      );
    });

    it('경합 count=0 → conflict throw', async () => {
      const { prisma, service } = setup(contentRow({ status: 'uploading' }));
      prisma.content.updateMany.mockResolvedValue({ count: 0 });
      await expectDomainError(
        service.failUploadTx(prisma, contentRow({ status: 'uploading' }), reporterUser()),
        'conflict',
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
