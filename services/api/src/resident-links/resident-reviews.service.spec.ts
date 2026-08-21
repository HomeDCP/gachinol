import { adminUser, contentRow, makePrismaMock, reporterUser } from '../test-support/fixtures';
import { DomainException } from '../common/errors/domain.exception';
import { ContentWorkflowService } from '../contents/content-workflow.service';
import { ResidentReviewsService } from './resident-reviews.service';
import { RESIDENT_UPLOAD_KEY_PREFIX } from './resident-links.constants';

/**
 * 주민 업로드 검수 (T-W2-24 — 대장 #86 · #103⑥ · 03 §C-5).
 *
 * ★ AC4("미승인 상태에서 인큐가 절대 일어나지 않음")의 절반을 여기서 고정한다: **액션 측** —
 * 승인이 아닌 모든 경로(반려·상태 충돌·게이트 실패·큐 비활성)에서 `enqueueTranscode` 호출이 0이어야 한다.
 * 나머지 절반(**엣지 측** — 누가 인큐하든 미승인이면 processing에 못 간다)은
 * `contents/content-workflow.service.spec.ts`의 "검수 게이트 관문" describe가 고정한다.
 */

const NOW = new Date('2026-08-16T00:00:00.000Z');

const uploadRow = (over: Record<string, unknown> = {}) => ({
  id: 'ru-1',
  linkId: 'rl-1',
  contentId: 'c-1',
  status: 'awaiting_branch_review',
  storageKey: `${RESIDENT_UPLOAD_KEY_PREFIX}/ru-1/original.mp4`,
  mimeType: 'video/mp4',
  sizeBytes: BigInt(2048),
  uploaderContact: '010-1234-5678',
  consentAgreedAt: NOW,
  reviewedByUserId: null,
  reviewedAt: null,
  completedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  link: { stationId: 's-aewol', station: { name: '애월 마을방송국' } },
  ...over,
});

const setup = (opts: { queueEnabled?: boolean; hasOriginal?: boolean } = {}) => {
  const prisma = makePrismaMock();
  prisma.residentUpload = {
    findUnique: jest.fn().mockResolvedValue(uploadRow()),
    findMany: jest.fn().mockResolvedValue([uploadRow()]),
    count: jest.fn().mockResolvedValue(1),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  prisma.content.findUnique.mockResolvedValue(
    contentRow({ id: 'c-1', origin: 'resident_link', reporterId: null, status: 'uploaded' }),
  );
  const residentLinks = { assertPipelineEntryAllowed: jest.fn().mockResolvedValue(undefined) };
  const producer = {
    enabled: opts.queueEnabled ?? true,
    enqueueTranscode: jest.fn().mockResolvedValue(undefined),
  };
  // 생산자가 인큐 직전에 요구하는 원본 자산 — 선확인이 그 함수를 그대로 재사용한다(사본 금지)
  const assets = {
    findOriginal: jest
      .fn()
      .mockResolvedValue(opts.hasOriginal === false ? null : { id: 'ma-1', kind: 'original' }),
  };
  // ★ 전이 서비스는 목이 아니라 **실물**이다(T-W2-31). 반려 종결(uploaded→canceled)이 실제로
  // `ContentWorkflowService.applyHop`(전이 단일 관문)을 통과해야 ① CAS·감사 로그 형태를 여기서
  // 검증할 수 있고 ② 미구동 계약 계측이 그 엣지를 "관측"으로 세어 NOT_WIRED 레지스트리에서 빠진다
  // (목으로 대체하면 계측이 못 보고 레지스트리가 stale된 채 그린이 된다).
  const workflow = new ContentWorkflowService(prisma);
  const service = new ResidentReviewsService(
    prisma,
    residentLinks as never,
    producer as never,
    assets as never,
    workflow,
  );
  return { prisma, residentLinks, producer, assets, workflow, service };
};

/** 반려 종결 홉의 감사 로그 1건 추출 — 없으면 undefined */
const cancelLog = (prisma: ReturnType<typeof makePrismaMock>) =>
  prisma.statusTransitionLog.create.mock.calls
    .map((c: [{ data: Record<string, unknown> }]) => c[0].data)
    .find((d: Record<string, unknown>) => d.toStatus === 'canceled');

const rejectsWith = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(DomainException);
  await expect(p).rejects.toMatchObject({ code });
};

/* ───────────────────── AC1. 검수 대기열 조회 ───────────────────── */

describe('ResidentReviewsService.listQueue (AC1)', () => {
  it('★ #103⑥ — uploaderContact·consentAgreedAt가 검수자 응답에 실린다(수집만 하고 못 보던 값)', async () => {
    const { service } = setup();
    const page = await service.listQueue(reporterUser(), { page: 1, pageSize: 20 } as never);

    expect(page.items[0]).toMatchObject({
      uploaderContact: '010-1234-5678',
      consentAgreedAt: NOW.toISOString(),
      stationName: '애월 마을방송국',
      contentId: 'c-1',
    });
    expect(page.totalCount).toBe(1);
  });

  it('화이트리스트 투영 — 내부 좌표(storageKey·linkId)는 싣지 않고 BigInt는 number로 내린다', async () => {
    const { service } = setup();
    const page = await service.listQueue(adminUser(), { page: 1, pageSize: 20 } as never);
    const item = page.items[0]!;

    expect(Object.keys(item)).not.toContain('storageKey');
    expect(Object.keys(item)).not.toContain('linkId');
    expect(JSON.stringify(item)).not.toContain(RESIDENT_UPLOAD_KEY_PREFIX);
    expect(item.sizeBytes).toBe(2048); // BigInt였다면 JSON.stringify가 TypeError로 죽는다
    expect(() => JSON.stringify(item)).not.toThrow();
  });

  it('★ 기자는 자기 지사만 — 쿼리로 타 지사를 지정해도 서버가 소속으로 덮어쓴다', async () => {
    const { prisma, service } = setup();
    await service.listQueue(reporterUser(), {
      page: 1,
      pageSize: 20,
      stationId: 's-jeju',
    } as never);

    expect(prisma.residentUpload.findMany.mock.calls[0][0].where).toMatchObject({
      link: { stationId: 's-aewol' },
    });
    expect(prisma.residentUpload.count.mock.calls[0][0].where).toMatchObject({
      link: { stationId: 's-aewol' },
    });
  });

  it('admin은 stationId 필터가 유효하고, 미지정이면 전 지사를 본다', async () => {
    const { prisma, service } = setup();
    await service.listQueue(adminUser(), { page: 1, pageSize: 20, stationId: 's-jeju' } as never);
    expect(prisma.residentUpload.findMany.mock.calls[0][0].where).toMatchObject({
      link: { stationId: 's-jeju' },
    });

    await service.listQueue(adminUser(), { page: 1, pageSize: 20 } as never);
    expect(prisma.residentUpload.findMany.mock.calls[1][0].where.link).toBeUndefined();
  });

  it('기본 status는 awaiting_branch_review, 정렬은 오래된 것부터(FIFO)', async () => {
    const { prisma, service } = setup();
    await service.listQueue(adminUser(), { page: 1, pageSize: 20 } as never);
    const args = prisma.residentUpload.findMany.mock.calls[0][0];
    expect(args.where.status).toBe('awaiting_branch_review');
    expect(args.orderBy).toEqual({ createdAt: 'asc' });

    await service.listQueue(adminUser(), { page: 1, pageSize: 20, status: 'rejected' } as never);
    expect(prisma.residentUpload.findMany.mock.calls[1][0].where.status).toBe('rejected');
  });

  it('page/pageSize가 skip/take로 반영되고 Paginated 형태로 나간다', async () => {
    const { prisma, service } = setup();
    const page = await service.listQueue(adminUser(), { page: 3, pageSize: 10 } as never);
    expect(prisma.residentUpload.findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 10 });
    expect(page).toMatchObject({ page: 3, pageSize: 10, totalCount: 1 });
  });
});

/* ───────────────────── AC2. 승인·반려 기록 ───────────────────── */

describe('ResidentReviewsService.findOne — 검수 단건 조회 (대장 #120)', () => {
  it('목록과 동일한 화이트리스트로 투영한다 — 내부 좌표(storageKey·linkId)는 나가지 않는다', async () => {
    const { service } = setup();

    const item = (await service.findOne(reporterUser(), 'ru-1')) as unknown as Record<string, unknown>;

    expect(item.id).toBe('ru-1');
    expect(item.status).toBe('awaiting_branch_review');
    expect(item.stationId).toBe('s-aewol');
    // 검수 판단 재료는 실린다(이 화면에서만 쓰이는 PII — 무인증 표면에는 없다)
    expect(item.uploaderContact).toBe('010-1234-5678');
    expect(item.consentAgreedAt).not.toBeNull();
    // BigInt는 직렬화 불가라 경계에서 number로 내려야 한다
    expect(item.sizeBytes).toBe(2048);
    // 내부 좌표 차단
    expect(item.storageKey).toBeUndefined();
    expect(item.linkId).toBeUndefined();
  });

  it('타 지사는 403, 미존재는 404 — 승인·반려와 같은 경계를 쓴다', async () => {
    const { prisma, service } = setup();

    await rejectsWith(
      service.findOne(reporterUser({ stationId: 's-jeju' as never }), 'ru-1'),
      'forbidden',
    );

    prisma.residentUpload.findUnique.mockResolvedValue(null);
    await rejectsWith(service.findOne(reporterUser(), 'ru-1'), 'not_found');
  });

  it('조회는 아무 것도 기록하지 않는다(읽기 전용)', async () => {
    const { prisma, producer, service } = setup();

    await service.findOne(reporterUser(), 'ru-1');

    expect(prisma.residentUpload.updateMany).not.toHaveBeenCalled();
    expect(producer.enqueueTranscode).not.toHaveBeenCalled();
  });
});

describe('ResidentReviewsService.approve / reject (AC2)', () => {
  it('★ 승인은 status=approved + 검수자·시각을 기록한다(#86 — 지금까지 0건이던 쓰기)', async () => {
    const { prisma, service } = setup();
    const item = await service.approve(reporterUser(), 'ru-1');

    const call = prisma.residentUpload.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'ru-1', status: 'awaiting_branch_review' }); // CAS
    expect(call.data.status).toBe('approved');
    expect(call.data.reviewedByUserId).toBe('u-reporter');
    expect(call.data.reviewedAt).toBeInstanceOf(Date);
    expect(item).toMatchObject({ status: 'approved', reviewedByUserId: 'u-reporter' });
    expect(item.reviewedAt).toEqual(expect.any(String));
  });

  it('★ 반려도 같은 자리에 기록되고, 인큐는 하지 않는다', async () => {
    const { prisma, producer, service } = setup();
    const item = await service.reject(reporterUser(), 'ru-1');

    expect(prisma.residentUpload.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'rejected',
      reviewedByUserId: 'u-reporter',
    });
    expect(item.status).toBe('rejected');
    expect(producer.enqueueTranscode).not.toHaveBeenCalled();
  });

  it('타 지사 업로드는 403, 미존재는 404 — 어느 쪽도 기록·인큐하지 않는다', async () => {
    const { prisma, producer, service } = setup();
    await rejectsWith(
      service.approve(reporterUser({ stationId: 's-jeju' as never }), 'ru-1'),
      'forbidden',
    );

    prisma.residentUpload.findUnique.mockResolvedValue(null);
    await rejectsWith(service.approve(reporterUser(), 'ru-1'), 'not_found');

    expect(prisma.residentUpload.updateMany).not.toHaveBeenCalled();
    expect(producer.enqueueTranscode).not.toHaveBeenCalled();
  });

  it('admin은 지사 경계를 넘어 검수할 수 있다(수퍼롤)', async () => {
    const { service } = setup();
    await expect(service.approve(adminUser(), 'ru-1')).resolves.toMatchObject({
      status: 'approved',
    });
  });

  it('동시 검수 경합: 승자와 결정이 같으면 멱등 성공, 다르면 409', async () => {
    const { prisma, service } = setup();
    prisma.residentUpload.updateMany.mockResolvedValue({ count: 0 });
    prisma.residentUpload.findUnique.mockResolvedValueOnce(uploadRow()); // loadForReview
    prisma.residentUpload.findUnique.mockResolvedValueOnce({ status: 'approved' }); // 재조회
    await expect(service.approve(reporterUser(), 'ru-1')).resolves.toMatchObject({
      status: 'approved',
    });

    prisma.residentUpload.findUnique.mockResolvedValueOnce(uploadRow());
    prisma.residentUpload.findUnique.mockResolvedValueOnce({ status: 'rejected' });
    await rejectsWith(service.approve(reporterUser(), 'ru-1'), 'conflict');
  });
});

/* ───────────────────── AC3. 승인 시 파이프라인 진입 ───────────────────── */

describe('ResidentReviewsService.approve — 파이프라인 진입 (AC3)', () => {
  it('★ assertPipelineEntryAllowed를 경유한 뒤에 트랜스코딩을 인큐한다(순서 고정)', async () => {
    const { residentLinks, producer, service } = setup();
    await service.approve(reporterUser(), 'ru-1');

    expect(residentLinks.assertPipelineEntryAllowed).toHaveBeenCalledWith('c-1');
    expect(producer.enqueueTranscode).toHaveBeenCalledTimes(1);
    expect(producer.enqueueTranscode.mock.calls[0][0]).toMatchObject({ id: 'c-1' });
    // 게이트가 인큐보다 먼저 — 우회 불가를 순서로 못박는다
    expect(residentLinks.assertPipelineEntryAllowed.mock.invocationCallOrder[0]!).toBeLessThan(
      producer.enqueueTranscode.mock.invocationCallOrder[0]!,
    );
  });

  it('멱등 재승인: 콘텐츠가 아직 uploaded면 재인큐(잡 유실 복구), 이미 진행 중이면 재인큐 없음', async () => {
    const { prisma, producer, service } = setup();
    prisma.residentUpload.findUnique.mockResolvedValue(
      uploadRow({ status: 'approved', reviewedByUserId: 'u-other', reviewedAt: NOW }),
    );

    const again = await service.approve(reporterUser(), 'ru-1');
    expect(prisma.residentUpload.updateMany).not.toHaveBeenCalled(); // 최초 검수자·시각 보존
    expect(again.reviewedByUserId).toBe('u-other');
    expect(producer.enqueueTranscode).toHaveBeenCalledTimes(1); // uploaded → 재인큐(복구)

    producer.enqueueTranscode.mockClear();
    prisma.content.findUnique.mockResolvedValue(
      contentRow({ id: 'c-1', origin: 'resident_link', status: 'published' }),
    );
    await service.approve(reporterUser(), 'ru-1');
    expect(producer.enqueueTranscode).not.toHaveBeenCalled(); // 현 세대 산출물 덮어쓰기 금지
  });

  it('★ 원본 자산이 없으면 승인을 거절한다 — 결정을 기록하기 전에(비대칭 금지, 게이트② 지적)', async () => {
    const { prisma, producer, service } = setup({ hasOriginal: false });

    const err = await service.approve(reporterUser(), 'ru-1').then(
      () => null,
      (e) => e as DomainException,
    );

    expect(err).toBeInstanceOf(DomainException);
    expect(err?.code).toBe('conflict'); // 500 internal이 아니라 의미 있는 상태 + 조치 가능한 문구
    expect(err?.message).toContain('원본 영상을 찾을 수 없어');
    // ★ 핵심: 검수 결정이 커밋되지 않는다 — 대기열에서 사라지고 콘텐츠는 uploaded에 남는 교착 방지
    expect(prisma.residentUpload.updateMany).not.toHaveBeenCalled();
    expect(producer.enqueueTranscode).not.toHaveBeenCalled();
  });

  it('선확인은 생산자가 인큐 직전에 보는 것과 같은 조건이다 (findOriginal(contentId, 1))', async () => {
    const { assets, service } = setup();
    await service.approve(reporterUser(), 'ru-1');
    expect(assets.findOriginal).toHaveBeenCalledWith('c-1', 1);
  });

  it('★ 반려에는 이 확인을 걸지 않는다 — 원본이 없는 건이야말로 반려 대상이다', async () => {
    const { prisma, assets, service } = setup({ hasOriginal: false });

    await expect(service.reject(reporterUser(), 'ru-1')).resolves.toMatchObject({
      status: 'rejected',
    });
    expect(assets.findOriginal).not.toHaveBeenCalled();
    expect(prisma.residentUpload.updateMany.mock.calls[0][0].data.status).toBe('rejected');
  });

  it('Redis 미설정이면 승인을 아예 받지 않는다 — 승인만 남고 처리되지 않는 교착 금지', async () => {
    const { prisma, producer, service } = setup({ queueEnabled: false });
    await rejectsWith(service.approve(reporterUser(), 'ru-1'), 'internal');
    expect(prisma.residentUpload.updateMany).not.toHaveBeenCalled();
    expect(producer.enqueueTranscode).not.toHaveBeenCalled();
  });

  it('반려는 큐가 죽어 있어도 가능하다 (07 §3-15 "불법촬영물 의심 시 즉시 반려")', async () => {
    const { prisma, service } = setup({ queueEnabled: false });
    await expect(service.reject(reporterUser(), 'ru-1')).resolves.toMatchObject({
      status: 'rejected',
    });
    expect(prisma.residentUpload.updateMany).toHaveBeenCalled();
  });
});

/* ───────────────────── AC4. 미승인 인큐 0 (액션 측) ───────────────────── */

describe('★★ 미승인 상태에서 인큐가 일어나지 않는다 (AC4 — 액션 측)', () => {
  it.each(['pending', 'upload_failed', 'rejected'])(
    '검수 대기가 아닌 상태(%s)의 승인 시도는 409이고 인큐는 없다 (모듈 전이맵이 판정)',
    async (status) => {
      const { prisma, producer, service } = setup();
      prisma.residentUpload.findUnique.mockResolvedValue(uploadRow({ status }));

      await rejectsWith(service.approve(reporterUser(), 'ru-1'), 'conflict');
      expect(prisma.residentUpload.updateMany).not.toHaveBeenCalled();
      expect(producer.enqueueTranscode).not.toHaveBeenCalled();
    },
  );

  it('게이트가 거절하면(승인 기록이 관철되지 않은 경합 등) 인큐하지 않는다', async () => {
    const { residentLinks, producer, service } = setup();
    residentLinks.assertPipelineEntryAllowed.mockRejectedValue(
      new DomainException('invalid_transition', '미승인'),
    );

    await rejectsWith(service.approve(reporterUser(), 'ru-1'), 'invalid_transition');
    expect(producer.enqueueTranscode).not.toHaveBeenCalled();
  });

  it('contentId가 비어 있는 비정상 행은 409로 멈춘다 — 인큐할 대상이 없다', async () => {
    const { prisma, producer, service } = setup();
    prisma.residentUpload.findUnique.mockResolvedValue(uploadRow({ contentId: null }));

    await rejectsWith(service.approve(reporterUser(), 'ru-1'), 'conflict');
    expect(producer.enqueueTranscode).not.toHaveBeenCalled();
  });
});

/* ─────────── AC5. 반려 시 콘텐츠 종결 (T-W2-31 — 대장 #112) ───────────
 * 반려된 주민 업로드의 Content가 `uploaded`에 영구 잔류하던 결함을 닫는다. 게이트가 파이프라인
 * 진입을 막아 **안전하긴 했지만** 종결되지 않았고, shared `AUTO_PROGRESS_CONTENT_STATUSES`
 * (`uploaded` 포함) 파생상 UI에는 "처리 중"으로 보였다.
 *
 * 여기서 쓰는 `ContentWorkflowService`는 **실물**이다(setup 주석 참조) — 전이 규칙·CAS·감사 로그가
 * 실제로 단일 관문을 통과하는지까지 이 스위트가 본다. */

describe('★★ 반려는 연결된 Content를 종결시킨다 (AC5)', () => {
  it('★ uploaded → canceled 전이를 단일 관문(applyHop)으로 실행한다 — CAS + 감사 로그', async () => {
    const { prisma, service } = setup();

    await expect(service.reject(reporterUser(), 'ru-1')).resolves.toMatchObject({
      status: 'rejected',
    });

    // CAS: from을 where에 실어 "uploaded일 때만" 종결된다
    expect(prisma.content.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-1', status: 'uploaded' },
        data: expect.objectContaining({ status: 'canceled' }),
      }),
    );
    expect(cancelLog(prisma)).toMatchObject({
      entityType: 'content',
      entityId: 'c-1',
      fromStatus: 'uploaded',
      toStatus: 'canceled',
    });
  });

  it('★ 액터는 system이고 actorUserId는 null이다 — 무주 콘텐츠라 사용자 액터가 될 수 없다', async () => {
    const { prisma, service } = setup();
    await service.reject(reporterUser(), 'ru-1');

    const log = cancelLog(prisma);
    expect(log).toMatchObject({ actorType: 'system', actorUserId: null, jobId: null });
    // 그래서 검수자·반려 사실의 유일한 흔적은 note다(구조화 컬럼 부재 = 대장 #113 별건)
    expect(log?.note).toContain('반려');
    expect(log?.note).toContain('u-reporter'); // 검수자 id
    expect(log?.note).toContain('ru-1'); // uploadId
  });

  it('★ 검수 결정과 종결이 같은 트랜잭션이다 — 부분 성공이 없다', async () => {
    const { prisma, service } = setup();
    const order: string[] = [];
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      order.push('tx:begin');
      const out = Array.isArray(arg)
        ? await Promise.all(arg)
        : await (arg as (tx: unknown) => Promise<unknown>)(prisma);
      order.push('tx:commit');
      return out;
    });
    prisma.residentUpload.updateMany.mockImplementation(async () => {
      order.push('upload:cas');
      return { count: 1 };
    });
    prisma.content.updateMany.mockImplementation(async () => {
      order.push('content:cas');
      return { count: 1 };
    });

    await service.reject(reporterUser(), 'ru-1');

    expect(order).toEqual(['tx:begin', 'upload:cas', 'content:cas', 'tx:commit']);
  });

  it('★ 종결이 터지면 검수 결정도 함께 롤백된다 — 반려 CAS가 트랜잭션 콜백 안에서 일어난다', async () => {
    const { prisma, service } = setup();
    // 목으로 실제 롤백을 재현할 수는 없다. 대신 롤백을 **보장하는 구조**를 본다:
    // 반려 기록이 트랜잭션 콜백 **안**에서 일어나고 그 콜백이 종결 실패로 throw하면,
    // 실 Prisma 인터랙티브 트랜잭션의 의미론상 반려 기록도 커밋되지 않는다.
    let insideTx = false;
    const where: string[] = [];
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      insideTx = true;
      try {
        return await (arg as (tx: unknown) => Promise<unknown>)(prisma);
      } finally {
        insideTx = false;
      }
    });
    prisma.residentUpload.updateMany.mockImplementation(async () => {
      where.push(insideTx ? 'in-tx' : 'outside-tx');
      return { count: 1 };
    });
    prisma.content.updateMany.mockRejectedValue(new Error('DB 장애'));

    await expect(service.reject(reporterUser(), 'ru-1')).rejects.toThrow('DB 장애');
    expect(where).toEqual(['in-tx']);
  });

  it('★ 멱등 — 이미 rejected인 건을 다시 반려해도 성공하고, 종결이 유실됐으면 보정한다', async () => {
    const { prisma, service } = setup();
    prisma.residentUpload.findUnique.mockResolvedValue(
      uploadRow({ status: 'rejected', reviewedByUserId: 'u-other', reviewedAt: NOW }),
    );

    const again = await service.reject(reporterUser(), 'ru-1');

    expect(again.status).toBe('rejected');
    expect(again.reviewedByUserId).toBe('u-other'); // 최초 검수자·시각 보존
    expect(prisma.residentUpload.updateMany).not.toHaveBeenCalled(); // 재기록 없음
    // ★ 종결 연쇄는 건너뛰지 않는다 — 구버전에서 반려됐거나 롤백된 건의 복구 경로
    expect(prisma.content.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c-1', status: 'uploaded' } }),
    );
  });

  it('★ 두 번 반려해도 두 번째가 깨지지 않는다 — 이미 canceled면 덮어쓰지 않는다', async () => {
    const { prisma, service } = setup();
    await service.reject(reporterUser(), 'ru-1');
    expect(cancelLog(prisma)).toBeDefined();

    // 2회차: 업로드는 rejected, 콘텐츠는 이미 canceled
    prisma.residentUpload.findUnique.mockResolvedValue(uploadRow({ status: 'rejected' }));
    prisma.content.findUnique.mockResolvedValue(
      contentRow({ id: 'c-1', origin: 'resident_link', reporterId: null, status: 'canceled' }),
    );
    prisma.content.updateMany.mockClear();
    prisma.statusTransitionLog.create.mockClear();

    await expect(service.reject(reporterUser(), 'ru-1')).resolves.toMatchObject({
      status: 'rejected',
    });
    expect(prisma.content.updateMany).not.toHaveBeenCalled(); // 재전이 시도 자체가 없다
    expect(prisma.statusTransitionLog.create).not.toHaveBeenCalled(); // 감사 로그 중복 없음
  });

  it.each(['processing', 'published', 'rejected'])(
    '콘텐츠가 이미 uploaded를 떠났으면(%s) 덮어쓰지 않는다 — 반려 자체는 성공',
    async (status) => {
      const { prisma, service } = setup();
      prisma.content.findUnique.mockResolvedValue(
        contentRow({ id: 'c-1', origin: 'resident_link', reporterId: null, status }),
      );

      await expect(service.reject(reporterUser(), 'ru-1')).resolves.toMatchObject({
        status: 'rejected',
      });
      expect(prisma.residentUpload.updateMany).toHaveBeenCalled(); // 검수 결정은 기록됐다
      expect(prisma.content.updateMany).not.toHaveBeenCalled();
    },
  );

  it('contentId가 없는 건도 반려는 성공한다 — 종결할 콘텐츠가 없을 뿐(승인과 다른 판단)', async () => {
    const { prisma, service } = setup();
    prisma.residentUpload.findUnique.mockResolvedValue(uploadRow({ contentId: null }));

    await expect(service.reject(reporterUser(), 'ru-1')).resolves.toMatchObject({
      status: 'rejected',
    });
    expect(prisma.content.findUnique).not.toHaveBeenCalled(); // 조회조차 하지 않는다
    expect(prisma.content.updateMany).not.toHaveBeenCalled();
  });

  it('콘텐츠 행이 사라진 경우에도 반려는 막히지 않는다 (404를 던져 롤백시키지 않는다)', async () => {
    const { prisma, service } = setup();
    prisma.content.findUnique.mockResolvedValue(null);

    await expect(service.reject(reporterUser(), 'ru-1')).resolves.toMatchObject({
      status: 'rejected',
    });
    expect(prisma.content.updateMany).not.toHaveBeenCalled();
  });

  it('승인은 종결하지 않는다 (반대 결정에 종결이 새어 나가지 않음)', async () => {
    const { prisma, service } = setup();
    await service.approve(reporterUser(), 'ru-1');
    expect(cancelLog(prisma)).toBeUndefined();
  });
});
