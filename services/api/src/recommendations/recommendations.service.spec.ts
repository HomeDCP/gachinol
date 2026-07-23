import { Prisma } from '@prisma/client';
import {
  adminUser,
  centerOperatorUser,
  makePrismaMock,
  recommendationRow,
  reporterUser,
} from '../test-support/fixtures';
import { RecommendationsService } from './recommendations.service';
import { RecommendationWorkflowService } from './recommendation-workflow.service';

const C1 = '01920000-0000-7000-8000-0000000000a1';
const C2 = '01920000-0000-7000-8000-0000000000a2';

const item = (rank: number, contentId: string) => ({ contentId, rank, score: 0.5, reason: 'r' });

const setup = (
  opts: { inline?: { jobId: string; result: unknown } | null; stuckMs?: number } = {},
) => {
  const prisma = makePrismaMock();
  const workflow = new RecommendationWorkflowService(prisma);
  const producer = {
    enabled: opts.inline !== undefined,
    enqueueOrCompute: jest.fn().mockResolvedValue(opts.inline ?? null),
  };
  const config = { get: jest.fn().mockReturnValue(opts.stuckMs ?? 600000) };
  const service = new RecommendationsService(
    prisma,
    workflow,
    producer as never,
    config as never,
  );
  return { prisma, workflow, producer, config, service };
};

describe('RecommendationsService.generate — 주차 멱등 분기', () => {
  it('없으면 generating 행 생성 + weekOf 서버 정규화(수요일→월요일)', async () => {
    const { prisma, producer, service } = setup();
    prisma.weeklyRecommendation.findUnique
      .mockResolvedValueOnce(null) // 조회
      .mockResolvedValue(recommendationRow()); // 이후 load
    prisma.weeklyRecommendation.create.mockResolvedValue(recommendationRow());

    await service.generate(adminUser(), { weekOf: '2026-06-03' } as never);

    expect(prisma.weeklyRecommendation.findUnique.mock.calls[0][0].where.weekOf.toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    );
    const created = prisma.weeklyRecommendation.create.mock.calls[0][0].data;
    expect(created.status).toBe('generating');
    expect(created.generation).toBe(1);
    expect(created.items).toEqual([]);
    // 인큐-애프터-커밋
    expect(producer.enqueueOrCompute).toHaveBeenCalledWith(
      expect.objectContaining({ weekOf: '2026-06-01', generation: 1, revisionRequestId: null }),
    );
    // 생성은 진입점 — 전이 로그 없음(content draft 선례)
    expect(prisma.statusTransitionLog.create).not.toHaveBeenCalled();
  });

  it('generation_failed면 재시도 — CAS로 generating 복귀 후 재큐', async () => {
    const { prisma, producer, service } = setup();
    const failed = recommendationRow({ status: 'generation_failed', generation: 2 });
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(failed);

    await service.generate(adminUser(), { weekOf: '2026-06-01' } as never);

    expect(prisma.weeklyRecommendation.create).not.toHaveBeenCalled();
    expect(prisma.weeklyRecommendation.updateMany.mock.calls[0][0].data.status).toBe('generating');
    expect(producer.enqueueOrCompute).toHaveBeenCalled();
  });

  it('★ 재시도는 미해소 수정요청을 다시 실어보낸다 — 지시 접두·해소 링크 유실 방지', async () => {
    const { prisma, producer, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'generation_failed', generation: 2 }),
    );
    prisma.revisionRequest.findFirst.mockResolvedValue({ id: 'rr-1', message: '특종을 앞으로' });

    await service.generate(adminUser(), { weekOf: '2026-06-01' } as never);

    expect(prisma.revisionRequest.findFirst.mock.calls[0][0].where).toEqual({
      recommendationId: 'wr-1',
      resolvedAt: null,
    });
    expect(producer.enqueueOrCompute).toHaveBeenCalledWith(
      expect.objectContaining({
        generation: 2,
        revisionRequestId: 'rr-1',
        revisionNote: '특종을 앞으로',
      }),
    );
  });

  it('생성 중(generating·regenerating)이면 409 — 200으로 뭉개지 않는다', async () => {
    for (const status of ['generating', 'regenerating'] as const) {
      const { prisma, producer, service } = setup();
      prisma.weeklyRecommendation.findUnique.mockResolvedValue(
        recommendationRow({ status, updatedAt: new Date() }), // 방금 진입 = 고착 아님
      );
      await expect(
        service.generate(adminUser(), { weekOf: '2026-06-01' } as never),
      ).rejects.toMatchObject({ code: 'conflict', message: '해당 주차 추천을 이미 생성 중입니다' });
      expect(producer.enqueueOrCompute).not.toHaveBeenCalled();
    }
  });

  it('★ 고착(RECOMMENDATION_STUCK_MS 초과) 진행중은 강제 실패 후 재시도 — 주차 영구 차단 방지', async () => {
    for (const status of ['generating', 'regenerating'] as const) {
      const { prisma, producer, service } = setup();
      const stuck = recommendationRow({
        status,
        generation: 2,
        updatedAt: new Date(Date.now() - 3600_000),
      });
      prisma.weeklyRecommendation.findUnique
        .mockResolvedValueOnce(stuck) // 주차 조회
        .mockResolvedValueOnce(stuck) // 강등 전 load(from 가드)
        .mockResolvedValue(recommendationRow({ status: 'generation_failed', generation: 2 }));

      await service.generate(adminUser(), { weekOf: '2026-06-01' } as never);

      const writes = prisma.weeklyRecommendation.updateMany.mock.calls.map((c: never[]) => c[0]);
      expect(writes[0].where).toEqual({ id: 'wr-1', status });
      expect(writes[0].data.status).toBe('generation_failed'); // 강등(map-legal)
      expect(writes[1].data.status).toBe('generating'); // 같은 요청에서 재시도
      expect(prisma.statusTransitionLog.create.mock.calls[0][0].data.note).toContain('생성 고착');
      expect(producer.enqueueOrCompute).toHaveBeenCalled();
    }
  });

  it('고착 강등 CAS 실패(그 사이 전진)는 409 — 뭉개지 않는다', async () => {
    const { prisma, producer, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'generating', updatedAt: new Date(Date.now() - 3600_000) }),
    );
    prisma.weeklyRecommendation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.generate(adminUser(), { weekOf: '2026-06-01' } as never),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(producer.enqueueOrCompute).not.toHaveBeenCalled();
  });

  it('이미 검토·승인된 주차는 409 + details로 상세 유도', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'pending_review' }),
    );
    await expect(
      service.generate(adminUser(), { weekOf: '2026-06-01' } as never),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { id: 'wr-1', status: 'pending_review' },
    });
  });

  it('동시 POST 경합(P2002) → conflict', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(null);
    prisma.weeklyRecommendation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: '6',
      }),
    );
    await expect(
      service.generate(adminUser(), { weekOf: '2026-06-01' } as never),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('기자는 403', async () => {
    const { service } = setup();
    await expect(
      service.generate(reporterUser(), { weekOf: '2026-06-01' } as never),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('인라인 폴백이면 그 자리에서 결과를 기록(같은 기록 경로)', async () => {
    const { prisma, service } = setup({
      inline: {
        jobId: 'recommendation:wr-1:g1',
        result: { items: [item(1, C1)], summary: '총평', candidateCount: 3 },
      },
    });
    prisma.weeklyRecommendation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(recommendationRow({ status: 'generating' }));
    prisma.weeklyRecommendation.create.mockResolvedValue(recommendationRow());

    await service.generate(adminUser(), { weekOf: '2026-06-01' } as never);

    const writes = prisma.weeklyRecommendation.updateMany.mock.calls.map((c: never[]) => c[0]);
    // ① items 기록(세대 CAS) → ② 전이
    expect(writes[0].where).toEqual({ id: 'wr-1', generation: 1 });
    expect(writes[0].data.summary).toBe('총평');
    expect(writes[0].data.generatedByJobId).toBe('recommendation:wr-1:g1');
    expect(writes[1].data.status).toBe('pending_review');
  });
});

describe('RecommendationsService.applyGenerationResult — 유일 기록 진입점', () => {
  const result = (items: unknown[]) => ({ items, summary: 's', candidateCount: items.length });

  it('items 기록 먼저 → 전이 (관제가 pending_review 볼 땐 items 선존재)', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'generating' }),
    );
    await service.applyGenerationResult('wr-1', 1, 'job-1', result([item(1, C1)]) as never);

    const writes = prisma.weeklyRecommendation.updateMany.mock.calls.map((c: never[]) => c[0]);
    expect(writes[0].data.items).toEqual([item(1, C1)]);
    expect(writes[1].data.status).toBe('pending_review');
  });

  it('★ 세대 CAS — 구세대 결과는 신세대를 덮지 못한다', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'regenerating', generation: 2 }),
    );
    await service.applyGenerationResult('wr-1', 1, 'job-1', result([item(1, C1)]) as never);
    expect(prisma.weeklyRecommendation.updateMany).not.toHaveBeenCalled();
  });

  it('후보 0건 → generation_failed(note) — 빈 검토 화면을 만들지 않는다', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'generating' }),
    );
    await service.applyGenerationResult('wr-1', 1, 'job-1', result([]) as never);

    const write = prisma.weeklyRecommendation.updateMany.mock.calls[0][0];
    expect(write.data.status).toBe('generation_failed');
    expect(prisma.statusTransitionLog.create.mock.calls[0][0].data.note).toBe('대상 콘텐츠 0건');
  });

  it('regenerating 완료 시 RevisionRequest 해소(resolvedAt·resolvedByJobId)', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'regenerating', generation: 2 }),
    );
    await service.applyGenerationResult('wr-1', 2, 'job-2', result([item(1, C1)]) as never);

    const call = prisma.revisionRequest.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ recommendationId: 'wr-1', resolvedAt: null });
    expect(call.data.resolvedByJobId).toBe('job-2');
    expect(call.data.resolvedAt).toBeInstanceOf(Date);
  });

  it('★ 재시도 완주(from=generating)도 RevisionRequest를 해소한다 — 영구 미해소 방지', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'generating', generation: 2 }),
    );
    await service.applyGenerationResult('wr-1', 2, 'job-2', result([item(1, C1)]) as never);

    const call = prisma.revisionRequest.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ recommendationId: 'wr-1', resolvedAt: null });
    expect(call.data.resolvedByJobId).toBe('job-2');
  });

  it('★ 계약 밖 items(score 범위 초과)는 기록하지 않고 generation_failed — 읽기 500 원천 차단', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'generating' }),
    );
    await service.applyGenerationResult(
      'wr-1',
      1,
      'job-1',
      result([{ ...item(1, C1), score: 4.2 }]) as never,
    );

    const writes = prisma.weeklyRecommendation.updateMany.mock.calls.map((c: never[]) => c[0]);
    expect(writes).toHaveLength(1); // items 기록 자체가 없다
    expect(writes[0].data.status).toBe('generation_failed');
    expect(prisma.statusTransitionLog.create.mock.calls[0][0].data.note).toContain(
      'items 계약 위반',
    );
  });

  it('generating·regenerating이 아니면 no-op (재수신·추월)', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'approved' }),
    );
    await service.applyGenerationResult('wr-1', 1, 'job-1', result([item(1, C1)]) as never);
    expect(prisma.weeklyRecommendation.updateMany).not.toHaveBeenCalled();
  });

  it('failGeneration: 진행 중일 때만 generation_failed로', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'pending_review' }),
    );
    await service.failGeneration('wr-1', 'job-1', '워커 폭발');
    expect(prisma.weeklyRecommendation.updateMany).not.toHaveBeenCalled();
  });
});

describe('RecommendationsService.requestRevision — 2홉 연쇄', () => {
  it('pending_review→revision_requested(user) → regenerating(system) + RevisionRequest 생성', async () => {
    const { prisma, producer, service } = setup();
    prisma.weeklyRecommendation.findUnique
      .mockResolvedValueOnce(recommendationRow({ status: 'pending_review' }))
      .mockResolvedValue(recommendationRow({ status: 'regenerating', generation: 2 }));

    await service.requestRevision('wr-1', centerOperatorUser(), { note: '날씨를 앞으로' } as never);

    const hops = prisma.statusTransitionLog.create.mock.calls.map(
      (c: never[]) => (c[0] as unknown as { data: Record<string, unknown> }).data,
    );
    expect(hops).toHaveLength(2);
    expect(hops[0]).toMatchObject({ toStatus: 'revision_requested', actorType: 'user' });
    expect(hops[1]).toMatchObject({ toStatus: 'regenerating', actorType: 'system' });

    const rr = prisma.revisionRequest.create.mock.calls[0][0].data;
    expect(rr.targetKind).toBe('recommendation');
    expect(rr.recommendationId).toBe('wr-1');
    expect(rr.contentId).toBeNull();
    expect(rr.requesterRole).toBe('center_operator');
    expect(rr.message).toBe('날씨를 앞으로');

    // 커밋 후 재큐 — 새 세대 + 수정지시 스냅샷
    expect(producer.enqueueOrCompute).toHaveBeenCalledWith(
      expect.objectContaining({
        generation: 2,
        revisionRequestId: rr.id,
        revisionNote: '날씨를 앞으로',
        excludeContentIds: [],
      }),
    );
  });

  it('pending_review가 아니면 409 (approved에서 수정요청 불가)', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'approved' }),
    );
    await expect(
      service.requestRevision('wr-1', adminUser(), { note: 'x' } as never),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('RecommendationsService.getReview — 조인 조립', () => {
  const contentRowWith = (id: string, title: string) => ({
    id,
    title,
    category: 'news',
    status: 'published',
    stationId: 's-aewol',
    station: { name: '애월 마을방송국' },
    reporterId: null,
    reporter: null,
    durationSec: 100,
    createdAt: new Date('2026-06-02T00:00:00Z'),
    publishedAt: new Date('2026-06-02T00:00:00Z'),
  });

  it('items는 rank순 ContentSummary 조인', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'pending_review', items: [item(2, C2), item(1, C1)] as never }),
    );
    prisma.content.findMany.mockResolvedValue([
      contentRowWith(C2, '두번째'),
      contentRowWith(C1, '첫번째'),
    ]);

    const out = await service.getReview('wr-1');
    expect(out.items.map((i) => i.item.rank)).toEqual([1, 2]);
    expect(out.items[0]!.content.title).toBe('첫번째');
    expect(out.items[0]!.content.stationName).toBe('애월 마을방송국');
  });

  it('삭제된 콘텐츠는 응답 items에서 조용히 제외 — 원본 recommendation.items는 불변', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findUnique.mockResolvedValue(
      recommendationRow({ status: 'pending_review', items: [item(1, C1), item(2, C2)] as never }),
    );
    prisma.content.findMany.mockResolvedValue([contentRowWith(C1, '남은 것')]);

    const out = await service.getReview('wr-1');
    expect(out.items).toHaveLength(1);
    expect(out.recommendation.items).toHaveLength(2); // 원본 전량
  });
});

describe('RecommendationsService.list', () => {
  it('weekOf 내림차순 + status 필터', async () => {
    const { prisma, service } = setup();
    prisma.weeklyRecommendation.findMany.mockResolvedValue([recommendationRow()]);
    prisma.weeklyRecommendation.count.mockResolvedValue(1);

    const out = await service.list({ page: 1, pageSize: 20, status: 'pending_review' } as never);
    const args = prisma.weeklyRecommendation.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ status: 'pending_review' });
    expect(args.orderBy).toEqual({ weekOf: 'desc' });
    expect(out.totalCount).toBe(1);
    expect(out.items[0]!.weekOf).toBe('2026-06-01');
  });
});
