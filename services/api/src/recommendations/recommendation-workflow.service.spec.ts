import { DomainException } from '../common/errors/domain.exception';
import {
  adminUser,
  centerOperatorUser,
  makePrismaMock,
  recommendationRow,
  reporterUser,
} from '../test-support/fixtures';
import { RecommendationWorkflowService } from './recommendation-workflow.service';

const setup = () => {
  const prisma = makePrismaMock();
  return { prisma, service: new RecommendationWorkflowService(prisma) };
};

describe('RecommendationWorkflowService — 전이 단일 관문', () => {
  it('approve: pending_review→approved + 승인자 기록 + 감사 로그', async () => {
    const { prisma, service } = setup();
    const row = recommendationRow({ status: 'pending_review' });
    const user = centerOperatorUser();

    await service.approve(prisma, row, user);

    const call = prisma.weeklyRecommendation.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: row.id, status: 'pending_review' }); // ★ CAS
    expect(call.data.status).toBe('approved');
    expect(call.data.approvedByUserId).toBe(user.id);
    expect(call.data.approvedAt).toBeInstanceOf(Date);

    const log = prisma.statusTransitionLog.create.mock.calls[0][0].data;
    expect(log.entityType).toBe('weekly_recommendation');
    expect(log.fromStatus).toBe('pending_review');
    expect(log.toStatus).toBe('approved');
    expect(log.actorType).toBe('user');
    expect(log.actorUserId).toBe(user.id);
  });

  it('CAS count=0 (동시 경합) → 409 conflict', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.approve(prisma, recommendationRow({ status: 'pending_review' }), adminUser()),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(prisma.statusTransitionLog.create).not.toHaveBeenCalled(); // 로그 미기록
  });

  it('기자는 어떤 전이도 못 한다 (서비스단 센터 가드)', async () => {
    const { prisma, service } = setup();
    await expect(
      service.approve(prisma, recommendationRow({ status: 'pending_review' }), reporterUser()),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('단계가 아니면 conflict (규칙 위반과 구분)', async () => {
    const { prisma, service } = setup();
    await expect(
      service.approve(prisma, recommendationRow({ status: 'generating' }), adminUser()),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('requestRevision: pending_review→revision_requested, note는 200자 절단', async () => {
    const { prisma, service } = setup();
    await service.requestRevision(
      prisma,
      recommendationRow({ status: 'pending_review' }),
      adminUser(),
      '가'.repeat(500),
    );
    expect(prisma.statusTransitionLog.create.mock.calls[0][0].data.note).toHaveLength(200);
  });

  it('beginRegeneration: revision_requested→regenerating은 system 액터 + generation+1', async () => {
    const { prisma, service } = setup();
    await service.beginRegeneration(
      prisma,
      recommendationRow({ status: 'revision_requested' }),
      '수정 지시',
    );
    const call = prisma.weeklyRecommendation.updateMany.mock.calls[0][0];
    expect(call.data.status).toBe('regenerating');
    expect(call.data.generation).toEqual({ increment: 1 }); // ★ 상태별 효과
    const log = prisma.statusTransitionLog.create.mock.calls[0][0].data;
    expect(log.actorType).toBe('system');
    expect(log.actorUserId).toBeNull();
  });

  it('retryGeneration: generation_failed→generating (세대 유지)', async () => {
    const { prisma, service } = setup();
    await service.retryGeneration(
      prisma,
      recommendationRow({ status: 'generation_failed', generation: 2 }),
      adminUser(),
    );
    const call = prisma.weeklyRecommendation.updateMany.mock.calls[0][0];
    expect(call.where.status).toBe('generation_failed');
    expect(call.data.status).toBe('generating');
    expect(call.data.generation).toBeUndefined();
  });

  it('applySystemTransition: from 불일치는 무해 no-op(재수신·추월 수렴)', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'pending_review' }),
    );
    const out = await service.applySystemTransition('wr-1', 'generating', 'pending_review', 'job-1');
    expect(out.applied).toBe(false);
    expect(prisma.weeklyRecommendation.updateMany).not.toHaveBeenCalled();
  });

  it('applySystemTransition: 맵 비합법 전이는 invalid_transition', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'approved' }),
    );
    await expect(
      service.applySystemTransition('wr-1', 'approved', 'pending_review', 'job-1'),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('applySystemTransition: 정상 홉은 jobId를 로그에 남긴다', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'generating' }),
    );
    const out = await service.applySystemTransition(
      'wr-1',
      'generating',
      'generation_failed',
      'recommendation:wr-1:g1',
      { note: '대상 콘텐츠 0건' },
    );
    expect(out.applied).toBe(true);
    const log = prisma.statusTransitionLog.create.mock.calls[0][0].data;
    expect(log.jobId).toBe('recommendation:wr-1:g1');
    expect(log.note).toBe('대상 콘텐츠 0건');
  });

  it('load: 없으면 not_found', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(null);
    await expect(service.load('nope')).rejects.toBeInstanceOf(DomainException);
  });
});
