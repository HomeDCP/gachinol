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

const setup = (contentOver: Record<string, unknown> = {}) => {
  const content = contentRow({ id: 'c-1', status: 'draft', ...contentOver });
  const contents = { loadOwned: jest.fn().mockResolvedValue(content) };
  const workflow = {
    beginUpload: jest.fn().mockResolvedValue(content),
    completeUpload: jest.fn().mockResolvedValue(contentRow({ id: 'c-1', status: 'uploaded' })),
    failUpload: jest.fn().mockResolvedValue(contentRow({ id: 'c-1', status: 'upload_failed' })),
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
  const service = new UploadService(
    contents as never,
    workflow as never,
    assets as never,
    s3 as never,
    producer as never,
  );
  return { contents, workflow, assets, s3, producer, service };
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

  it('completeUpload: HEAD 부재 → markFailed + failUpload + 400', async () => {
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
    expect(workflow.failUpload).toHaveBeenCalledWith('c-1', expect.anything());
    expect(producer.enqueueTranscode).not.toHaveBeenCalled();
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
