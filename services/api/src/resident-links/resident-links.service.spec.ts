import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminUser, contentRow, makePrismaMock, reporterUser } from '../test-support/fixtures';
import { DomainException } from '../common/errors/domain.exception';
import { generateResidentLinkToken, hashResidentLinkToken } from './resident-link-token';
import {
  RESIDENT_LINK_MAX_UPLOADS,
  RESIDENT_LINK_TTL_MS,
  RESIDENT_UPLOAD_KEY_PREFIX,
  RESIDENT_UPLOAD_MAX_BYTES,
} from './resident-links.constants';
import { ResidentLinksService } from './resident-links.service';

const TOKEN = generateResidentLinkToken();
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const linkRow = (over: Record<string, unknown> = {}) => ({
  id: 'rl-1',
  tokenHash: hashResidentLinkToken(TOKEN),
  stationId: 's-aewol',
  issuedByUserId: 'u-reporter',
  expiresAt: new Date(Date.now() + RESIDENT_LINK_TTL_MS),
  maxUploads: RESIDENT_LINK_MAX_UPLOADS,
  usedCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  station: { name: '애월 마을방송국' },
  ...over,
});

const uploadRow = (over: Record<string, unknown> = {}) => ({
  id: 'ru-1',
  linkId: 'rl-1',
  contentId: null,
  status: 'pending',
  storageKey: `${RESIDENT_UPLOAD_KEY_PREFIX}/ru-1/original.mp4`,
  mimeType: 'video/mp4',
  sizeBytes: BigInt(1024),
  uploaderContact: null,
  consentAgreedAt: null,
  reviewedByUserId: null,
  reviewedAt: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const uploadDto = (over: Record<string, unknown> = {}) =>
  ({ fileName: '해녀축제.mp4', mimeType: 'video/mp4', sizeBytes: 1024, ...over }) as never;

const setup = () => {
  const prisma = makePrismaMock();
  prisma.residentUploadLink = {
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  prisma.residentUpload = {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const s3 = {
    bucket: 'gachinol-media',
    presignPut: jest
      .fn()
      .mockResolvedValue({ url: 'https://s3.test/put', expiresAt: '2026-08-15T00:15:00.000Z' }),
    headObject: jest.fn(),
  };
  const assets = { createOriginalPending: jest.fn(), markReady: jest.fn() };
  const service = new ResidentLinksService(prisma, s3 as never, assets as never);
  return { prisma, s3, assets, service };
};

const rejectsWith = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(DomainException);
  await expect(p).rejects.toMatchObject({ code });
};

/* ───────────────────── ① 발급 (AC2-1 · AC3 72h · AC5 토큰 안전성) ───────────────────── */

describe('ResidentLinksService.issue', () => {
  it('★ 토큰 원문을 저장하지 않는다 — DB에는 sha256 해시만, 원문은 응답으로 1회', async () => {
    const { prisma, service } = setup();
    prisma.station.findUnique.mockResolvedValue({ id: 's-aewol', name: '애월 마을방송국' });
    prisma.residentUploadLink.create.mockImplementation(async (args: never) => ({
      ...linkRow(),
      ...(args as { data: Record<string, unknown> }).data,
    }));

    const issued = await service.issue(reporterUser(), {} as never);

    const data = prisma.residentUploadLink.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashResidentLinkToken(issued.token));
    expect(JSON.stringify(data)).not.toContain(issued.token); // 어떤 컬럼에도 원문 없음
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.id).toMatch(UUID_V7); // AC6 — 앱 발급 UUID v7
  });

  it('만료는 발급 + 72시간, 건수는 5건 스냅샷 (03 §C-5)', async () => {
    const { prisma, service } = setup();
    prisma.station.findUnique.mockResolvedValue({ id: 's-aewol', name: '애월 마을방송국' });
    prisma.residentUploadLink.create.mockImplementation(async (args: never) => ({
      ...linkRow(),
      ...(args as { data: Record<string, unknown> }).data,
      usedCount: 0,
    }));

    const before = Date.now();
    const issued = await service.issue(reporterUser(), {} as never);
    const expiresAt = (prisma.residentUploadLink.create.mock.calls[0][0].data.expiresAt as Date).getTime();

    expect(expiresAt).toBeGreaterThanOrEqual(before + RESIDENT_LINK_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + RESIDENT_LINK_TTL_MS);
    expect(RESIDENT_LINK_TTL_MS).toBe(72 * 60 * 60 * 1000);
    expect(prisma.residentUploadLink.create.mock.calls[0][0].data.maxUploads).toBe(5);
    expect(issued.maxUploads).toBe(5);
    expect(issued.remainingUploads).toBe(5);
    expect(issued.maxFileSizeBytes).toBe(RESIDENT_UPLOAD_MAX_BYTES);
  });

  it('기자는 자기 소속 지사로만 — 타 지사 지정은 403, 발급자·지사가 대장에 남는다', async () => {
    const { prisma, service } = setup();
    prisma.station.findUnique.mockResolvedValue({ id: 's-aewol', name: '애월 마을방송국' });
    prisma.residentUploadLink.create.mockResolvedValue(linkRow());

    await rejectsWith(
      service.issue(reporterUser(), { stationId: 's-jeju' } as never),
      'forbidden',
    );

    await service.issue(reporterUser(), {} as never);
    const data = prisma.residentUploadLink.create.mock.calls[0][0].data;
    expect(data.stationId).toBe('s-aewol'); // 토큰에서 해석(바디 수신 금지)
    expect(data.issuedByUserId).toBe('u-reporter'); // 07 §3-15 발급 대장
  });

  it('admin은 stationId 필수(소속 지사가 없을 수 있다), 없는 지사는 404', async () => {
    const { prisma, service } = setup();
    await rejectsWith(service.issue(adminUser(), {} as never), 'validation_failed');

    prisma.station.findUnique.mockResolvedValue(null);
    await rejectsWith(service.issue(adminUser(), { stationId: 's-x' } as never), 'not_found');
  });
});

/* ───────────────────── ② 공개 조회 (AC2-2 화이트리스트) ───────────────────── */

describe('ResidentLinksService.describe', () => {
  it('★ 비밀 누출 금지 — 발급자·연락처·내부 id는 응답에 없다', async () => {
    const { prisma, service } = setup();
    prisma.residentUploadLink.findUnique.mockResolvedValue(linkRow());

    const view = await service.describe(TOKEN);

    expect(Object.keys(view).sort()).toEqual(
      ['expiresAt', 'maxFileSizeBytes', 'maxUploads', 'remainingUploads', 'stationName', 'valid'].sort(),
    );
    expect(JSON.stringify(view)).not.toContain('rl-1'); // 링크 id
    expect(JSON.stringify(view)).not.toContain('u-reporter'); // 발급자
    expect(JSON.stringify(view)).not.toContain('s-aewol'); // 지사 id
    expect(JSON.stringify(view)).not.toContain(hashResidentLinkToken(TOKEN));
    expect(view.valid).toBe(true);
  });

  it('만료·소진은 valid=false + reason (404가 아니다 — 재발급 안내를 위해)', async () => {
    const { prisma, service } = setup();
    prisma.residentUploadLink.findUnique.mockResolvedValue(
      linkRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    expect(await service.describe(TOKEN)).toMatchObject({ valid: false, reason: 'expired' });

    prisma.residentUploadLink.findUnique.mockResolvedValue(linkRow({ usedCount: 5 }));
    expect(await service.describe(TOKEN)).toMatchObject({
      valid: false,
      reason: 'exhausted',
      remainingUploads: 0,
    });
  });

  it('형식 오류·미존재는 동일한 404로 수렴(존재 여부 오라클 차단) — 형식 오류는 DB도 안 친다', async () => {
    const { prisma, service } = setup();
    await rejectsWith(service.describe('not-a-token'), 'not_found');
    expect(prisma.residentUploadLink.findUnique).not.toHaveBeenCalled();

    prisma.residentUploadLink.findUnique.mockResolvedValue(null);
    await rejectsWith(service.describe(TOKEN), 'not_found');
  });
});

/* ───────────────────── ③ presign 발급 (AC2-3 · AC3 5건·500MB) ───────────────────── */

describe('ResidentLinksService.createUpload', () => {
  it('슬롯 CAS(used_count < max_uploads) 후 presign — 미검수 프리픽스에 저장', async () => {
    const { prisma, s3, service } = setup();
    prisma.residentUploadLink.findUnique
      .mockResolvedValueOnce(linkRow())
      .mockResolvedValue({ maxUploads: 5, usedCount: 1 });

    const ticket = await service.createUpload(TOKEN, uploadDto());

    const cas = prisma.residentUploadLink.updateMany.mock.calls[0][0];
    expect(cas.where).toMatchObject({ id: 'rl-1', usedCount: { lt: 5 } });
    expect(cas.data).toEqual({ usedCount: { increment: 1 } });
    expect(s3.presignPut.mock.calls[0][0]).toMatch(
      new RegExp(`^${RESIDENT_UPLOAD_KEY_PREFIX}/${UUID_V7.source.slice(1, -1)}/original\\.mp4$`),
    );
    expect(ticket.uploadUrl).toBe('https://s3.test/put');
    expect(ticket.remainingUploads).toBe(4);
    expect(prisma.residentUpload.create.mock.calls[0][0].data.status).toBe('pending');
  });

  it('★ 익명 입력이 스토리지 키를 비틀지 못한다 — 확장자 문자셋을 좁게 재검증', async () => {
    const { prisma, s3, service } = setup();
    prisma.residentUploadLink.findUnique.mockResolvedValue(linkRow());
    const keyShape = new RegExp(
      `^${RESIDENT_UPLOAD_KEY_PREFIX}/${UUID_V7.source.slice(1, -1)}/original\\.mp4$`,
    );

    await service.createUpload(
      TOKEN,
      uploadDto({ fileName: '../../etc/passwd', mimeType: 'video/../../evil' }),
    );
    expect(s3.presignPut.mock.calls[0][0]).toMatch(keyShape);

    await service.createUpload(TOKEN, uploadDto({ fileName: 'a'.repeat(20) + '.verylongextension' }));
    expect(s3.presignPut.mock.calls[1][0]).toMatch(keyShape);
  });

  it('링크당 5건 초과 = 403 (CAS가 하드가드 — 동시 요청도 정확히 5건만 승리)', async () => {
    const { prisma, service } = setup();
    prisma.residentUploadLink.findUnique.mockResolvedValue(linkRow({ usedCount: 5 }));
    prisma.residentUploadLink.updateMany.mockResolvedValue({ count: 0 });

    await rejectsWith(service.createUpload(TOKEN, uploadDto()), 'forbidden');
    expect(prisma.residentUpload.create).not.toHaveBeenCalled();
  });

  it('건당 500MB 초과 = 403(400 아님, 02 §D-T9) — 슬롯도 소비하지 않는다', async () => {
    const { prisma, service } = setup();
    prisma.residentUploadLink.findUnique.mockResolvedValue(linkRow());

    await rejectsWith(
      service.createUpload(TOKEN, uploadDto({ sizeBytes: RESIDENT_UPLOAD_MAX_BYTES + 1 })),
      'forbidden',
    );
    expect(prisma.residentUploadLink.updateMany).not.toHaveBeenCalled();
  });

  it('만료 링크는 403', async () => {
    const { prisma, service } = setup();
    prisma.residentUploadLink.findUnique.mockResolvedValue(
      linkRow({ expiresAt: new Date(Date.now() - 1) }),
    );
    await rejectsWith(service.createUpload(TOKEN, uploadDto()), 'forbidden');
  });

  it('★ presign 실패 시 소비한 슬롯을 되돌린다(고아 소비 금지)', async () => {
    const { prisma, s3, service } = setup();
    prisma.residentUploadLink.findUnique.mockResolvedValue(linkRow());
    s3.presignPut.mockRejectedValue(new DomainException('internal', 'S3 자격 없음'));

    await rejectsWith(service.createUpload(TOKEN, uploadDto()), 'internal');
    expect(prisma.residentUploadLink.updateMany.mock.calls[1][0].data).toEqual({
      usedCount: { decrement: 1 },
    });
    expect(prisma.residentUpload.create).not.toHaveBeenCalled();
  });

  it('07 §3-15 파생 필드 — 연락처·동의 시각만 기록(그 밖의 개인정보·IP는 저장하지 않는다)', async () => {
    const { prisma, service } = setup();
    prisma.residentUploadLink.findUnique.mockResolvedValue(linkRow());

    await service.createUpload(
      TOKEN,
      uploadDto({ uploaderContact: '010-0000-0000', consentAgreed: true }),
    );

    const data = prisma.residentUpload.create.mock.calls[0][0].data;
    expect(data.uploaderContact).toBe('010-0000-0000');
    expect(data.consentAgreedAt).toBeInstanceOf(Date);
    expect(Object.keys(data).sort()).toEqual(
      [
        'id',
        'linkId',
        'status',
        'storageKey',
        'mimeType',
        'sizeBytes',
        'uploaderContact',
        'consentAgreedAt',
      ].sort(),
    );
  });

  it('동의하지 않아도(문구 확정 전) 업로드는 되고 동의 시각만 null로 남는다', async () => {
    const { prisma, service } = setup();
    prisma.residentUploadLink.findUnique.mockResolvedValue(linkRow());
    await service.createUpload(TOKEN, uploadDto());
    expect(prisma.residentUpload.create.mock.calls[0][0].data.consentAgreedAt).toBeNull();
  });
});

/* ───────────────────── ④ 완료 통지 → 검수 대기열 (AC1 · AC2-4) ───────────────────── */

describe('ResidentLinksService.completeUpload', () => {
  const arrange = () => {
    const ctx = setup();
    ctx.prisma.residentUploadLink.findUnique
      .mockResolvedValueOnce(linkRow())
      .mockResolvedValue({ maxUploads: 5, usedCount: 1 });
    ctx.prisma.residentUpload.findUnique.mockResolvedValue(uploadRow());
    ctx.s3.headObject.mockResolvedValue({ sizeBytes: 2048 });
    return ctx;
  };

  it('★ origin=resident_link · reporterId=null · status=uploaded로 태어난다 (AC1)', async () => {
    const { prisma, service } = arrange();

    const receipt = await service.completeUpload(TOKEN, 'ru-1');

    const created = prisma.content.create.mock.calls[0][0].data;
    expect(created.origin).toBe('resident_link');
    expect(created.reporterId).toBeNull();
    expect(created.status).toBe('uploaded');
    expect(created.reviewPolicy).toBe('reporter_then_center'); // 가장 보수적인 기본
    expect(created.id).toMatch(UUID_V7);
    expect(receipt.status).toBe('awaiting_branch_review');
  });

  it('★ 미디어 큐를 인큐하지 않는다 — 큐를 주입받을 통로 자체가 없다(구조적 강제)', async () => {
    const { service } = arrange();
    await service.completeUpload(TOKEN, 'ru-1');
    // 생성자는 (prisma, s3, assets) 3개뿐 — QueueProducerService·BullMQ 의존 0
    expect(ResidentLinksService.length).toBe(3);
  });

  it('업로드 행은 검수 대기열로, 실측 크기·완료 시각이 기록된다', async () => {
    const { prisma, assets, service } = arrange();
    await service.completeUpload(TOKEN, 'ru-1');

    const updated = prisma.residentUpload.update.mock.calls[0][0].data;
    expect(updated.status).toBe('awaiting_branch_review');
    expect(updated.sizeBytes).toBe(BigInt(2048));
    expect(updated.completedAt).toBeInstanceOf(Date);
    expect(updated.contentId).toMatch(UUID_V7);
    // 원본 자산은 MediaAssetsService(유일 기록자)를 통해서만 등록
    expect(assets.createOriginalPending).toHaveBeenCalled();
    expect(assets.markReady).toHaveBeenCalled();
  });

  it('재전송은 멱등 — 콘텐츠를 두 번 만들지 않고 같은 영수증을 돌려준다', async () => {
    const { prisma, assets, service } = setup();
    prisma.residentUploadLink.findUnique
      .mockResolvedValueOnce(linkRow())
      .mockResolvedValue({ maxUploads: 5, usedCount: 1 });
    prisma.residentUpload.findUnique.mockResolvedValue(
      uploadRow({ status: 'awaiting_branch_review', contentId: 'c-9' }),
    );

    const receipt = await service.completeUpload(TOKEN, 'ru-1');

    expect(receipt.status).toBe('awaiting_branch_review');
    expect(prisma.content.create).not.toHaveBeenCalled();
    expect(assets.createOriginalPending).toHaveBeenCalled(); // 누락 자산 보정
  });

  it('오브젝트 부재 → upload_failed + 슬롯 반환 + 400', async () => {
    const { prisma, s3, service } = arrange();
    s3.headObject.mockResolvedValue(null);

    await rejectsWith(service.completeUpload(TOKEN, 'ru-1'), 'validation_failed');
    expect(prisma.residentUpload.updateMany.mock.calls[0][0].data.status).toBe('upload_failed');
    expect(prisma.residentUploadLink.updateMany.mock.calls[0][0].data).toEqual({
      usedCount: { decrement: 1 },
    });
    expect(prisma.content.create).not.toHaveBeenCalled();
  });

  it('★ 실측 크기가 500MB 초과면 403 — 신고값만 믿지 않는다(presign은 크기를 강제 못 한다)', async () => {
    const { prisma, s3, service } = arrange();
    s3.headObject.mockResolvedValue({ sizeBytes: RESIDENT_UPLOAD_MAX_BYTES + 1 });

    await rejectsWith(service.completeUpload(TOKEN, 'ru-1'), 'forbidden');
    expect(prisma.content.create).not.toHaveBeenCalled();
    expect(prisma.residentUpload.updateMany.mock.calls[0][0].data.status).toBe('upload_failed');
  });

  it('다른 링크의 uploadId·이미 종결된 업로드는 거절', async () => {
    const { prisma, service } = setup();
    prisma.residentUploadLink.findUnique.mockResolvedValue(linkRow());
    prisma.residentUpload.findUnique.mockResolvedValue(uploadRow({ linkId: 'rl-other' }));
    await rejectsWith(service.completeUpload(TOKEN, 'ru-1'), 'not_found');

    prisma.residentUpload.findUnique.mockResolvedValue(uploadRow({ status: 'upload_failed' }));
    await rejectsWith(service.completeUpload(TOKEN, 'ru-1'), 'conflict');
  });
});

/* ─────────────── ⑤ 검수 게이트 서버측 강제 (AC4 — 필수 단위 테스트) ─────────────── */

describe('★★ assertPipelineEntryAllowed — 검수 승인 전 processing 진입 차단 (03 §C-5)', () => {
  it('미승인(검수 대기) 주민 업로드물은 거절된다', async () => {
    const { prisma, service } = setup();
    prisma.content.findUnique.mockResolvedValue({ origin: 'resident_link' });
    prisma.residentUpload.findUnique.mockResolvedValue({ status: 'awaiting_branch_review' });

    await rejectsWith(service.assertPipelineEntryAllowed('c-1'), 'invalid_transition');
    await expect(service.assertPipelineEntryAllowed('c-1')).rejects.toMatchObject({
      details: { origin: 'resident_link', reviewStatus: 'awaiting_branch_review' },
    });
  });

  it('반려된 업로드물·업로드 행이 없는 유령 콘텐츠도 거절(fail-closed)', async () => {
    const { prisma, service } = setup();
    prisma.content.findUnique.mockResolvedValue({ origin: 'resident_link' });

    prisma.residentUpload.findUnique.mockResolvedValue({ status: 'rejected' });
    await rejectsWith(service.assertPipelineEntryAllowed('c-1'), 'invalid_transition');

    prisma.residentUpload.findUnique.mockResolvedValue(null);
    await rejectsWith(service.assertPipelineEntryAllowed('c-1'), 'invalid_transition');
  });

  it('지사 담당자 승인 후에는 통과한다', async () => {
    const { prisma, service } = setup();
    prisma.content.findUnique.mockResolvedValue({ origin: 'resident_link' });
    prisma.residentUpload.findUnique.mockResolvedValue({ status: 'approved' });

    await expect(service.assertPipelineEntryAllowed('c-1')).resolves.toBeUndefined();
  });

  it('기존 유래(reporter_upload·live_vod)는 조회조차 하지 않고 통과 — 회귀 0', async () => {
    const { prisma, service } = setup();
    prisma.content.findUnique.mockResolvedValue({ origin: contentRow().origin });

    await expect(service.assertPipelineEntryAllowed('c-1')).resolves.toBeUndefined();
    expect(prisma.residentUpload.findUnique).not.toHaveBeenCalled();

    prisma.content.findUnique.mockResolvedValue({ origin: 'live_vod' });
    await expect(service.assertPipelineEntryAllowed('c-2')).resolves.toBeUndefined();
  });

  it('없는 콘텐츠는 404', async () => {
    const { prisma, service } = setup();
    prisma.content.findUnique.mockResolvedValue(null);
    await rejectsWith(service.assertPipelineEntryAllowed('c-none'), 'not_found');
  });
});

/* ─────────── ⑥ 무인증 표면의 큐 무의존 (T-W2-24 보강 — 게이트② 지적) ───────────
 * T-W2-08은 "ResidentLinksModule이 QueueModule을 모른다"를 검수 게이트의 1차 강제로 삼았다.
 * T-W2-24가 승인 시 인큐를 붙이며 그 보증은 **DI 경계에서 파일 규율로 낮아졌다** — 큐를 아는 것은
 * 인증 전용 ResidentReviewsService 하나뿐이고, 무인증 3종을 소유한 이 서비스는 여전히 큐를 모른다.
 * 규율은 테스트가 없으면 규율이 아니다: 아래는 이 파일에 큐 의존이 **추가되는 순간 레드**가 된다.
 *
 * ── 위 "생성자 3개" 테스트와의 관계 (중복이 아닌 이유) ─────────────────────────
 * T-W2-08이 이미 `ResidentLinksService.length === 3`을 고정했지만 그것은 **생성자 인자만** 본다.
 * Nest는 프로퍼티 주입(`@Inject(MEDIA_QUEUE) private queue: Queue`)도 지원하고, 협력자 없이 모듈
 * 스코프에서 큐를 직접 만들 수도 있다 — 둘 다 arity 3을 유지한 채 통과한다. 아래는 **실행 코드의
 * 심볼**을 보므로 그 경로까지 막는다(생성자 의존을 추가하면 두 테스트가 함께 레드가 된다 — 고의 파손으로 확인).
 * (엣지 측 최후 방어선은 content-workflow.service.spec.ts의 "검수 게이트 관문"이 따로 고정한다.) */
describe('★★ 무인증 표면은 인큐 수단을 갖지 않는다 (ResidentLinksService 큐 무의존)', () => {
  it('큐 심볼을 코드에서 참조하지 않는다 — 어떤 형태의 의존이든 붙으면 레드가 된다', () => {
    // 주석이 아닌 **실행 코드**만 남긴다: 이 파일의 한국어 주석은 "인큐하지 않는다"처럼 큐를 언급하되
    // ASCII 심볼은 쓰지 않지만, 주석을 벗겨야 규칙이 문구 변화에 흔들리지 않는다.
    const code = readFileSync(join(__dirname, 'resident-links.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    for (const symbol of ['QueueProducerService', 'MEDIA_QUEUE', 'bullmq', 'enqueue', 'Queue']) {
      expect(code).not.toContain(symbol);
    }
  });
});
