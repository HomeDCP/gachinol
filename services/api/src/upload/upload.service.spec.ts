import { DomainException } from '../common/errors/domain.exception';
import { contentRow, reporterUser } from '../test-support/fixtures';
import { UploadService } from './upload.service';

const dtoIssue = (over: Record<string, unknown> = {}) => ({
  contentId: 'c-1',
  fileName: 'clip.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 1000,
  ...over,
});

/** $transaction 콜백에 넘길 tx 스텁 — 두 쓰기가 같은 트랜잭션을 받는지(원자성) 식별용 sentinel */
const TX_SENTINEL = { __tx: 'sentinel' } as const;

const setup = (contentOver: Record<string, unknown> = {}) => {
  const content = contentRow({ id: 'c-1', status: 'draft', ...contentOver });
  const contents = { loadOwned: jest.fn().mockResolvedValue(content) };
  const workflow = {
    beginUpload: jest.fn().mockResolvedValue(content),
    completeUpload: jest.fn().mockResolvedValue(contentRow({ id: 'c-1', status: 'uploaded' })),
    failUpload: jest.fn().mockResolvedValue(contentRow({ id: 'c-1', status: 'upload_failed' })),
    failUploadTx: jest.fn().mockResolvedValue(undefined),
  };
  const assets = {
    originalKey: (id: string, ext: string) => `contents/${id}/g1/original.${ext}`,
    createOriginalPending: jest.fn().mockResolvedValue(undefined),
    findOriginal: jest.fn().mockResolvedValue({ storageKey: 'contents/c-1/g1/original.mp4' }),
    markReady: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
  const s3 = {
    presignPut: jest.fn().mockResolvedValue({ url: 'https://put', expiresAt: '2026-07-22T00:15:00.000Z' }),
    headObject: jest.fn().mockResolvedValue({ sizeBytes: 1000 }),
  };
  const producer = { enabled: true, enqueueTranscode: jest.fn().mockResolvedValue(undefined) };
  // 실 Prisma $transaction과 동형: 콜백을 tx로 즉시 호출(성공)하거나, 콜백이 던지면 그대로 reject
  // (실 Postgres의 롤백을 대신하지 않는다 — 여기서 검증하는 것은 "두 쓰기가 한 콜백 안에 묶였는가"다)
  const prisma = { $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(TX_SENTINEL)) };
  const service = new UploadService(
    contents as never,
    workflow as never,
    assets as never,
    s3 as never,
    producer as never,
    prisma as never,
  );
  return { contents, workflow, assets, s3, producer, prisma, service };
};

const expectError = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(DomainException);
  expect((err as DomainException).code).toBe(code);
};

describe('UploadService — issue/complete 오케스트레이션', () => {
  it('issueUploadUrl: 자산 pending 생성 → beginUpload → presignPut, storageKey 반환', async () => {
    const { assets, workflow, s3, service } = setup();
    const res = await service.issueUploadUrl(reporterUser(), 'c-1', dtoIssue() as never);

    expect(assets.createOriginalPending).toHaveBeenCalledWith(
      'c-1',
      'contents/c-1/g1/original.mp4',
      'video/mp4',
      1000,
    );
    expect(workflow.beginUpload).toHaveBeenCalledWith('c-1', expect.anything());
    expect(s3.presignPut).toHaveBeenCalledWith('contents/c-1/g1/original.mp4', {
      contentType: 'video/mp4',
    });
    expect(res).toEqual({
      storageKey: 'contents/c-1/g1/original.mp4',
      uploadUrl: 'https://put',
      expiresAt: '2026-07-22T00:15:00.000Z',
    });
  });

  it('issueUploadUrl: draft·upload_failed 외 상태는 409', async () => {
    const { service } = setup({ status: 'uploaded' });
    await expectError(service.issueUploadUrl(reporterUser(), 'c-1', dtoIssue() as never), 'conflict');
  });

  it('issueUploadUrl: body.contentId ≠ 경로 id면 400', async () => {
    const { service } = setup();
    await expectError(
      service.issueUploadUrl(reporterUser(), 'c-1', dtoIssue({ contentId: 'c-2' }) as never),
      'validation_failed',
    );
  });

  it('issueUploadUrl: Redis 미설정(pipeline 비활성)이면 internal', async () => {
    const { producer, service } = setup();
    (producer as { enabled: boolean }).enabled = false;
    await expectError(service.issueUploadUrl(reporterUser(), 'c-1', dtoIssue() as never), 'internal');
  });

  it('completeUpload: HEAD 성공 → markReady → completeUpload → enqueueTranscode', async () => {
    const { assets, workflow, producer, service } = setup({ status: 'uploading' });
    const res = await service.completeUpload(reporterUser(), 'c-1', {
      contentId: 'c-1',
      storageKey: 'contents/c-1/g1/original.mp4',
    } as never);

    expect(assets.markReady).toHaveBeenCalledWith('contents/c-1/g1/original.mp4', { sizeBytes: 1000 });
    expect(workflow.completeUpload).toHaveBeenCalledWith('c-1', expect.anything());
    expect(producer.enqueueTranscode).toHaveBeenCalled();
    expect(res.id).toBe('c-1');
  });

  it('completeUpload: HEAD 부재 → markFailed + failUploadTx + 400', async () => {
    const { s3, assets, workflow, producer, service } = setup({ status: 'uploading' });
    s3.headObject.mockResolvedValue(null);
    await expectError(
      service.completeUpload(reporterUser(), 'c-1', {
        contentId: 'c-1',
        storageKey: 'contents/c-1/g1/original.mp4',
      } as never),
      'validation_failed',
    );
    expect(assets.markFailed).toHaveBeenCalled();
    expect(workflow.failUploadTx).toHaveBeenCalledWith(
      TX_SENTINEL,
      expect.objectContaining({ id: 'c-1' }),
      expect.anything(),
    );
    expect(producer.enqueueTranscode).not.toHaveBeenCalled();
  });

  /**
   * 대장 #168 회귀 가드 — 자산 markFailed와 콘텐츠 failUploadTx가 **같은 트랜잭션**(단일
   * `prisma.$transaction` 호출)으로 묶였는지 구조적으로 고정한다. 이전 결함은 두 쓰기가 별개
   * 커밋이라 그 사이 프로세스가 죽으면(실기 2건) 자산만 failed로 남고 콘텐츠는 uploading에
   * 영구 고착했다 — 재발급은 ISSUABLE(draft·upload_failed) 밖이라 409, findOriginal이 failed
   * 자산을 제외해 완료 경로까지 막혔다. 누군가 다시 `assets.markFailed(key)` +
   * `workflow.failUpload(id, user)` 형태(트랜잭션 밖 개별 호출)로 되돌리면 이 테스트가 깨진다
   * (`$transaction` 호출 0회 또는 `failUploadTx` 미호출로 드러난다).
   */
  it('completeUpload: HEAD 부재 시 두 쓰기가 단일 prisma.$transaction으로 원자적으로 묶인다 (대장 #168)', async () => {
    const { s3, assets, workflow, prisma, service } = setup({ status: 'uploading' });
    s3.headObject.mockResolvedValue(null);
    await expectError(
      service.completeUpload(reporterUser(), 'c-1', {
        contentId: 'c-1',
        storageKey: 'contents/c-1/g1/original.mp4',
      } as never),
      'validation_failed',
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // 두 쓰기 모두 $transaction이 넘긴 동일 tx를 받는다 — 별개 커밋이 아니라 한 트랜잭션
    expect(assets.markFailed).toHaveBeenCalledWith('contents/c-1/g1/original.mp4', TX_SENTINEL);
    expect(workflow.failUploadTx).toHaveBeenCalledWith(
      TX_SENTINEL,
      expect.anything(),
      expect.anything(),
    );
  });

  /**
   * "두 쓰기 사이에서 죽는" 상황의 모사 — 트랜잭션 콜백 안에서 두 번째 쓰기(콘텐츠 전이)가
   * 실패하면(예: 커밋 직전 DB 연결 유실) 그 오류가 그대로 전파돼야 한다. `validation_failed`로
   * 위장해 "복구 표기가 끝났다"고 거짓 보고하지 않는다 — 트랜잭션이므로 첫 번째 쓰기(자산 failed
   * 표기)도 함께 롤백된다는 것이 이 원자화의 요지다.
   */
  it('completeUpload: 트랜잭션 콜백 도중 실패하면 원래 오류가 그대로 전파된다(validation_failed로 위장하지 않음)', async () => {
    const { s3, workflow, service } = setup({ status: 'uploading' });
    s3.headObject.mockResolvedValue(null);
    workflow.failUploadTx.mockRejectedValue(new Error('DB 연결 유실(트랜잭션 커밋 직전)'));

    await expect(
      service.completeUpload(reporterUser(), 'c-1', {
        contentId: 'c-1',
        storageKey: 'contents/c-1/g1/original.mp4',
      } as never),
    ).rejects.toThrow('DB 연결 유실(트랜잭션 커밋 직전)');
  });

  it('completeUpload: 발급 key와 불일치하면 400(임의 key 주입 차단)', async () => {
    const { service } = setup({ status: 'uploading' });
    await expectError(
      service.completeUpload(reporterUser(), 'c-1', {
        contentId: 'c-1',
        storageKey: 'contents/c-1/g1/evil.mp4',
      } as never),
      'validation_failed',
    );
  });
});
