import { CONTENT_RETRY_TARGET } from '@gachinol/shared';
import { DomainException } from '../common/errors/domain.exception';
import {
  adminUser,
  centerOperatorUser,
  contentRow,
  makePrismaMock,
  reporterUser,
} from '../test-support/fixtures';
import { ContentWorkflowService } from './content-workflow.service';

describe('ContentWorkflowService — 전이 단일 관문', () => {
  const setup = (row: ReturnType<typeof contentRow>) => {
    const prisma = makePrismaMock();
    prisma.content.findUnique.mockResolvedValue(row);
    const service = new ContentWorkflowService(prisma);
    return { prisma, service };
  };

  const expectDomainError = async (p: Promise<unknown>, code: string) => {
    const err = await p.then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).code).toBe(code);
    return err as DomainException;
  };

  describe('범용 transition', () => {
    it('허용 전이(draft→uploading)를 통과시키고 CAS·로그를 기록한다', async () => {
      const row = contentRow({ status: 'draft' });
      const { prisma, service } = setup(row);

      await service.transition(row.id, 'uploading', adminUser());

      expect(prisma.content.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: row.id, status: 'draft' } }),
      );
      expect(prisma.statusTransitionLog.create).toHaveBeenCalledTimes(1);
      const log = prisma.statusTransitionLog.create.mock.calls[0][0].data;
      expect(log).toMatchObject({
        entityType: 'content',
        entityId: row.id,
        fromStatus: 'draft',
        toStatus: 'uploading',
        actorType: 'user',
        actorUserId: 'u-admin',
      });
    });

    it('금지 전이(draft→published)는 invalid_transition + details.allowed', async () => {
      const { service } = setup(contentRow({ status: 'draft' }));
      const err = await expectDomainError(
        service.transition('c-1', 'published', adminUser()),
        'invalid_transition',
      );
      expect(err.details).toMatchObject({ from: 'draft', to: 'published' });
      expect(err.details?.allowed).toEqual(['uploading', 'canceled']);
    });

    it('revision_requested로의 범용 전이는 거부한다 (RevisionRequest 동일 트랜잭션 강제)', async () => {
      const { service } = setup(contentRow({ status: 'awaiting_center_review' }));
      await expectDomainError(
        service.transition('c-1', 'revision_requested', adminUser()),
        'forbidden',
      );
    });

    it('CAS affected=0이면 409 conflict (동시 경합)', async () => {
      const { prisma, service } = setup(contentRow({ status: 'draft' }));
      prisma.content.updateMany.mockResolvedValue({ count: 0 });
      await expectDomainError(service.transition('c-1', 'uploading', adminUser()), 'conflict');
    });

    it('→published 시 publishedAt 세팅, →regenerating 시 generation+1', async () => {
      const publishing = contentRow({ status: 'publishing', publishedAt: null });
      const { prisma, service } = setup(publishing);
      await service.transition('c-1', 'published', adminUser());
      expect(prisma.content.updateMany.mock.calls[0][0].data.publishedAt).toBeInstanceOf(Date);

      const revision = contentRow({ status: 'revision_requested' });
      const { prisma: p2, service: s2 } = setup(revision);
      await s2.transition('c-1', 'regenerating', adminUser());
      expect(p2.content.updateMany.mock.calls[0][0].data.generation).toEqual({ increment: 1 });
    });

    it('범용 전이로 center_approved 진입 시에도 approvedByUserId·approvedAt 기록 (approve와 경로 독립)', async () => {
      const row = contentRow({ status: 'awaiting_center_review' });
      const { prisma, service } = setup(row);

      await service.transition(row.id, 'center_approved', centerOperatorUser());

      const data = prisma.content.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('center_approved');
      expect(data.approvedByUserId).toBe('u-center');
      expect(data.approvedAt).toBeInstanceOf(Date);
    });
  });

  describe('origin 정책 가드 (§11-4)', () => {
    it('reporter_upload는 preview_generating→awaiting_center_review 직행 불가', async () => {
      const { service } = setup(
        contentRow({ status: 'preview_generating', origin: 'reporter_upload' }),
      );
      await expectDomainError(
        service.transition('c-1', 'awaiting_center_review', adminUser()),
        'invalid_transition',
      );
    });

    it('live_vod는 preview_generating→awaiting_reporter_review 불가 (기자 승인 생략 경로)', async () => {
      const { service } = setup(
        contentRow({ status: 'preview_generating', origin: 'live_vod', reporterId: null }),
      );
      await expectDomainError(
        service.transition('c-1', 'awaiting_reporter_review', adminUser()),
        'invalid_transition',
      );
    });

    // 대장 #87 (T-W2-13 편입분) — T-W2-08이 ContentOrigin에 resident_link를 추가하며 생긴
    // preview_generating 출구 사각(reporter_upload·live_vod 어느 쪽도 아님)을 해소한다.
    // 근거: resident_link도 담당 기자가 없다(reporterId=null, shared content.ts 불변식) — live_vod와
    // 동일 사유로 센터 검토 직행이 유일하게 완주 가능한 출구다(awaiting_reporter_review는 담당 기자
    // 소유 검사 때문에 애초에 통과 불능).
    it('resident_link는 preview_generating→awaiting_center_review로 전이 가능(신설 출구)', async () => {
      const { prisma, service } = setup(
        contentRow({ status: 'preview_generating', origin: 'resident_link', reporterId: null }),
      );
      await service.transition('c-1', 'awaiting_center_review', adminUser());
      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe('awaiting_center_review');
    });

    it('resident_link는 preview_generating→awaiting_reporter_review로는 여전히 거절(다른 출구는 불가)', async () => {
      const { service } = setup(
        contentRow({ status: 'preview_generating', origin: 'resident_link', reporterId: null }),
      );
      await expectDomainError(
        service.transition('c-1', 'awaiting_reporter_review', adminUser()),
        'invalid_transition',
      );
    });
  });

  describe('미성년자 피촬영자 동의 게이트 (07 §3-3·02 §E-20, T-W2-13 본체, fail-closed)', () => {
    it('센터 검토 승인: hasMinorSubject=true + 미확인 → invalid_transition (approve() 경유)', async () => {
      const row = contentRow({
        status: 'awaiting_center_review',
        hasMinorSubject: true,
        minorConsentConfirmedAt: null,
      });
      const { service } = setup(row);
      const err = await expectDomainError(
        service.approve(row.id, centerOperatorUser()),
        'invalid_transition',
      );
      expect(err.details).toMatchObject({
        from: 'awaiting_center_review',
        to: 'center_approved',
        hasMinorSubject: true,
      });
    });

    it('센터 검토 승인: hasMinorSubject=true + 확인 완료 → 통과 (approve() 경유)', async () => {
      const row = contentRow({
        status: 'awaiting_center_review',
        hasMinorSubject: true,
        minorConsentConfirmedByUserId: 'u-center',
        minorConsentConfirmedAt: new Date('2026-08-10T00:00:00.000Z'),
      });
      const { prisma, service } = setup(row);
      await service.approve(row.id, centerOperatorUser());
      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe('center_approved');
    });

    it('센터 검토 승인: hasMinorSubject=false → 무영향으로 통과 (기존 경로 회귀 없음)', async () => {
      const row = contentRow({
        status: 'awaiting_center_review',
        hasMinorSubject: false,
        minorConsentConfirmedAt: null,
      });
      const { prisma, service } = setup(row);
      await service.approve(row.id, centerOperatorUser());
      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe('center_approved');
    });

    it('범용 transition()으로 center_approved 진입해도 동일 게이트 적용(우회 불가)', async () => {
      const row = contentRow({
        status: 'awaiting_center_review',
        hasMinorSubject: true,
        minorConsentConfirmedAt: null,
      });
      const { service } = setup(row);
      await expectDomainError(
        service.transition(row.id, 'center_approved', centerOperatorUser()),
        'invalid_transition',
      );
    });

    it('reviewPolicy=reporter_only: hasMinorSubject=true + 미확인 → 기자 승인 자체가 차단(공개 송출 직행 경로 원천 봉쇄)', async () => {
      const row = contentRow({
        status: 'awaiting_reporter_review',
        reviewPolicy: 'reporter_only',
        hasMinorSubject: true,
        minorConsentConfirmedAt: null,
      });
      const { service } = setup(row);
      await expectDomainError(service.approve(row.id, reporterUser()), 'invalid_transition');
    });

    it('reviewPolicy=reporter_only: hasMinorSubject=true + 확인 완료 → publishing까지 자동 연쇄 통과', async () => {
      const row = contentRow({
        status: 'awaiting_reporter_review',
        reviewPolicy: 'reporter_only',
        hasMinorSubject: true,
        minorConsentConfirmedByUserId: 'u-center',
        minorConsentConfirmedAt: new Date('2026-08-10T00:00:00.000Z'),
      });
      const { prisma, service } = setup(row);
      await service.approve(row.id, reporterUser());
      expect(prisma.content.updateMany.mock.calls[1][0].data.status).toBe('publishing');
    });

    it('reviewPolicy=reporter_then_center: hasMinorSubject=true + 미확인이어도 기자 승인 단계는 통과(센터 게이트가 후속으로 차단)', async () => {
      const row = contentRow({
        status: 'awaiting_reporter_review',
        reviewPolicy: 'reporter_then_center',
        hasMinorSubject: true,
        minorConsentConfirmedAt: null,
      });
      const { prisma, service } = setup(row);
      await service.approve(row.id, reporterUser());
      expect(prisma.content.updateMany.mock.calls[1][0].data.status).toBe('awaiting_center_review');
    });
  });

  describe('approve — afterReporterApproval 자동 연쇄', () => {
    it('reporter_only: reporter_approved → publishing, 로그 2건(2건째 system)', async () => {
      const row = contentRow({ status: 'awaiting_reporter_review', reviewPolicy: 'reporter_only' });
      const { prisma, service } = setup(row);

      await service.approve(row.id, reporterUser());

      expect(prisma.content.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe('reporter_approved');
      expect(prisma.content.updateMany.mock.calls[1][0].data.status).toBe('publishing');
      expect(prisma.statusTransitionLog.create).toHaveBeenCalledTimes(2);
      const second = prisma.statusTransitionLog.create.mock.calls[1][0].data;
      expect(second.actorType).toBe('system');
      expect(second.note).toContain('reporter_only');
    });

    it('reporter_then_center: reporter_approved → awaiting_center_review', async () => {
      const row = contentRow({
        status: 'awaiting_reporter_review',
        reviewPolicy: 'reporter_then_center',
      });
      const { prisma, service } = setup(row);

      await service.approve(row.id, reporterUser());

      expect(prisma.content.updateMany.mock.calls[1][0].data.status).toBe('awaiting_center_review');
    });

    it('기자 검토 단계 액션은 담당 기자만 (다른 기자·비소유 403)', async () => {
      const row = contentRow({ status: 'awaiting_reporter_review' });
      const { service } = setup(row);
      await expectDomainError(
        service.approve(row.id, reporterUser({ id: 'u-other' } as never)),
        'forbidden',
      );
    });

    it('awaiting_center_review 승인은 center_operator — publishing 자동 연쇄는 하지 않는다', async () => {
      const row = contentRow({ status: 'awaiting_center_review' });
      const { prisma, service } = setup(row);

      await service.approve(row.id, centerOperatorUser());

      expect(prisma.content.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe('center_approved');
      expect(prisma.content.updateMany.mock.calls[0][0].data.approvedByUserId).toBe('u-center');
    });
  });

  describe('retry — CONTENT_RETRY_TARGET 전 항목 왕복', () => {
    it.each(Object.entries(CONTENT_RETRY_TARGET))('%s → %s', async (from, to) => {
      const row = contentRow({ status: from });
      const { prisma, service } = setup(row);
      await service.retry(row.id, centerOperatorUser());
      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe(to);
    });

    it('기자는 upload_failed만 재시도 가능', async () => {
      const { service } = setup(contentRow({ status: 'processing_failed' }));
      await expectDomainError(service.retry('c-1', reporterUser()), 'forbidden');

      const { prisma: p2, service: s2 } = setup(contentRow({ status: 'upload_failed' }));
      await s2.retry('c-1', reporterUser());
      expect(p2.content.updateMany.mock.calls[0][0].data.status).toBe('uploading');
    });

    it('실패 상태가 아니면 invalid_transition', async () => {
      const { service } = setup(contentRow({ status: 'draft' }));
      await expectDomainError(service.retry('c-1', adminUser()), 'invalid_transition');
    });
  });

  describe('requestRevision — RevisionRequest 동일 트랜잭션', () => {
    it('센터 수정 요청 시 RevisionRequest 생성 + requesterRole 매핑', async () => {
      const row = contentRow({ status: 'awaiting_center_review' });
      const { prisma, service } = setup(row);

      await service.requestRevision(row.id, centerOperatorUser(), {
        note: '자막 오탈자 수정',
      } as never);

      expect(prisma.content.updateMany.mock.calls[0][0].data.status).toBe('revision_requested');
      const created = prisma.revisionRequest.create.mock.calls[0][0].data;
      expect(created).toMatchObject({
        targetKind: 'content',
        contentId: row.id,
        requesterRole: 'center_operator',
        message: '자막 오탈자 수정',
      });
    });
  });
});
