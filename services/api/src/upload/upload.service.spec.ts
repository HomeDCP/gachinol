import { DomainException } from '../common/errors/domain.exception';
import { MediaAssetsService } from '../media/media-assets.service';
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

  /**
   * 대장 #212 보완 (조율자 지시, verifier 뮤테이션 발견) — 위 테스트는 status: 'uploaded'만 써서
   * `ISSUABLE=['draft','upload_failed']`에 `'uploading'`을 몰래 추가하는 뮤테이션(교착을 "재발급을
   * 열어" 우회하는 가짜 수리 — 증상은 사라지지만 자산은 여전히 failed로 남고, 업로드 진행 중인
   * 콘텐츠에 재발급이 열려 상태머신 경계가 무너진다)에 **무반응**이었다: 'uploaded'는 그 뮤테이션
   * 전후로 여전히 ISSUABLE 밖이라 409가 그대로 나오기 때문이다. 여기서는 정확히 `'uploading'`
   * 상태를 직접 단언해 그 뮤테이션을 잡는다. 겸사겸사 ISSUABLE 경계 전체(허용 2종·거부 주요 상태들)를
   * 표로 덮는다.
   */
  it.each([
    'uploading',
    'uploaded',
    'processing',
    'analyzing',
    'preview_generating',
    'awaiting_reporter_review',
    'center_approved',
    'publishing',
    'published',
    'canceled',
  ] as const)('issueUploadUrl: status=%s는 409(ISSUABLE 밖)', async (status) => {
    const { service, workflow, s3 } = setup({ status });
    await expectError(service.issueUploadUrl(reporterUser(), 'c-1', dtoIssue() as never), 'conflict');
    // 409로 끝나야 하며, 발급 부수효과(beginUpload 전이·presign)가 조금이라도 일어나서는 안 된다.
    expect(workflow.beginUpload).not.toHaveBeenCalled();
    expect(s3.presignPut).not.toHaveBeenCalled();
  });

  it.each(['draft', 'upload_failed'] as const)(
    'issueUploadUrl: status=%s는 발급 허용(ISSUABLE 안)',
    async (status) => {
      const { service } = setup({ status });
      const res = await service.issueUploadUrl(reporterUser(), 'c-1', dtoIssue() as never);
      expect(res.storageKey).toBe('contents/c-1/g1/original.mp4');
    },
  );

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

  /**
   * 대장 #212 — 舊 버전은 "발급 key와 불일치하면 400"만 확인하고 그때 콘텐츠 상태를 묻지 않았다
   * (롤백 부재가 검사 밖). 그 사각이 실제 결함(#212)의 일부였다: 임의 key 주입이든 우리 쪽
   * 자산 부재든, completeUpload가 uploading에서 실패하면 uploading→{uploaded,upload_failed} 외
   * 출구가 없어(shared workflow.ts) 콘텐츠가 영구 고착됐다(I-2). 이제 이 경로도 failUploadTx로
   * 롤백하되, dto가 주장한(검증되지 않은) storageKey로는 어떤 media_assets 행도 건드리지 않는다
   * (함정1 — 이름이 겹치는 타 콘텐츠 자산 오염 방지). markFailed가 호출되지 않는 것으로 이를 고정한다.
   */
  it('completeUpload: 발급 key와 불일치하면 400(임의 key 주입 차단) + 콘텐츠는 upload_failed로 롤백(I-2)', async () => {
    const { assets, workflow, prisma, service } = setup({ status: 'uploading' });
    await expectError(
      service.completeUpload(reporterUser(), 'c-1', {
        contentId: 'c-1',
        storageKey: 'contents/c-1/g1/evil.mp4',
      } as never),
      'validation_failed',
    );
    expect(assets.markFailed).not.toHaveBeenCalled(); // 검증 안 된 key로 자산 오염 금지
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(workflow.failUploadTx).toHaveBeenCalledWith(
      TX_SENTINEL,
      expect.objectContaining({ id: 'c-1' }),
      expect.anything(),
    );
  });

  /**
   * 대장 #212 — findOriginal이 원본을 아예 못 찾는 경우(자산 행 부재·경합, 클라 입력과 무관)도
   * 같은 이유로 콘텐츠를 upload_failed로 되돌린다(I-2). 여기는 지울 자산 행 자체가 없다.
   */
  it('completeUpload: original 자산을 못 찾으면 400 + 콘텐츠는 upload_failed로 롤백(I-2)', async () => {
    const { assets, workflow, prisma, service } = setup({ status: 'uploading' });
    assets.findOriginal.mockResolvedValue(null);
    await expectError(
      service.completeUpload(reporterUser(), 'c-1', {
        contentId: 'c-1',
        storageKey: 'contents/c-1/g1/original.mp4',
      } as never),
      'validation_failed',
    );
    expect(assets.markFailed).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(workflow.failUploadTx).toHaveBeenCalledWith(
      TX_SENTINEL,
      expect.objectContaining({ id: 'c-1' }),
      expect.anything(),
    );
  });

  // ── 대장 #212 D1 — 재시도 시퀀스(1차 실패 → 2차 발급 → 2차 완료) ─────────────────────────
  // 기존 17건(9 issue/complete + 8 media-assets)은 전부 단건 호출만 검증해 이 결함(2차 재시도
  // 교착)을 못 잡았다. 여기서는 issueUploadUrl→completeUpload를 실제로 연쇄 호출해, 1차 실패가
  // 남긴 상태(=findOriginal이 반환하는 자산 행) 위에서 2차 발급·완료가 정말 복구되는지 확인한다.
  describe('재시도 시퀀스 (1차 HEAD 부재 → upload_failed → 2차 발급 → 2차 완료)', () => {
    /**
     * setup()의 assets 목은 정적 응답만 반환해 시퀀스 상태(재-issue가 이전 실패 이력을 지우는지)를
     * 못 담는다 — 그리고 그 상태 전이가 정확히 media-assets.service.ts의 실제 upsert(update)절이
     * 하는 일이므로, 여기서 그 계층을 다시 손으로 흉내 내면(mock) 이 서비스의 수리를 되돌려도
     * 이 테스트는 못 잡는다(뮤테이션 자가확인 필요조건). 그래서 **실제 MediaAssetsService**를
     * 생성하고, 그 아래 Prisma만 최소 in-memory 구현으로 대체한다 — createOriginalPending·
     * findOriginal·markReady·markFailed는 전부 실 코드가 돈다.
     */
    const setupSequence = () => {
      const content = contentRow({ id: 'c-1', status: 'draft' });
      let contentStatus = 'draft';
      // 실제 completeUpload/issueUploadUrl의 ISSUABLE·uploading 가드가 정말로 매 호출 시점의
      // 최신 상태를 보고 판정하도록, 고정 스냅샷이 아니라 contentStatus를 매번 반영한다.
      const contents = {
        loadOwned: jest.fn().mockImplementation(async () => ({ ...content, status: contentStatus })),
      };
      const workflow = {
        beginUpload: jest.fn().mockImplementation(async () => {
          contentStatus = 'uploading';
          return { ...content, status: contentStatus };
        }),
        completeUpload: jest.fn().mockImplementation(async () => {
          contentStatus = 'uploaded';
          return { ...content, status: contentStatus };
        }),
        failUpload: jest.fn(),
        failUploadTx: jest.fn().mockImplementation(async () => {
          contentStatus = 'upload_failed';
        }),
      };

      // storageKey(bucket 고정)로 색인한 media_assets 행의 최소 in-memory Prisma — MediaAssetsService가
      // 실제로 부르는 upsert/update/deleteMany/findFirst 인자 형태만 해석한다(스키마 전체 재구현 아님).
      type Row = {
        contentId: string;
        kind: string;
        generation: number;
        status: string;
        mimeType: string;
        sizeBytes: bigint;
        createdAt: number;
      };
      const rows = new Map<string, Row>();
      let seq = 0;
      const prismaForAssets: any = {
        mediaAsset: {
          upsert: jest.fn(async ({ where, create, update }: any) => {
            const key = where.bucket_storageKey.storageKey as string;
            const existing = rows.get(key);
            if (existing) {
              Object.assign(existing, update);
              return { ...existing };
            }
            const row: Row = { ...create, createdAt: seq++ };
            rows.set(key, row);
            return { ...row };
          }),
          update: jest.fn(async ({ where, data }: any) => {
            const key = where.bucket_storageKey.storageKey as string;
            const existing = rows.get(key);
            if (!existing) throw new Error('Record to update not found');
            Object.assign(existing, data);
            return { ...existing };
          }),
          deleteMany: jest.fn(async ({ where }: any) => {
            let count = 0;
            for (const [key, row] of [...rows.entries()]) {
              if (row.contentId !== where.contentId) continue;
              if (row.kind !== where.kind) continue;
              if (row.generation !== where.generation) continue;
              if (where.storageKey?.not && key === where.storageKey.not) continue;
              rows.delete(key);
              count++;
            }
            return { count };
          }),
          findFirst: jest.fn(async ({ where }: any) => {
            const matches = [...rows.entries()]
              .filter(([, row]) => {
                if (row.contentId !== where.contentId) return false;
                if (row.kind !== where.kind) return false;
                if (row.generation !== where.generation) return false;
                if (where.status?.not && row.status === where.status.not) return false;
                return true;
              })
              .sort((a, b) => b[1].createdAt - a[1].createdAt);
            const top = matches[0];
            return top ? { storageKey: top[0], ...top[1] } : null;
          }),
        },
      };
      // UploadService의 $transaction이 넘기는 tx가 markFailed(key, tx) 호출에서 실제로
      // 같은 저장소(rows)를 가리켜야 하므로, tx = prismaForAssets 그 자체로 둔다.
      prismaForAssets.$transaction = jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
        cb(prismaForAssets),
      );
      const assets = new MediaAssetsService(prismaForAssets, { bucket: 'gachinol-media' } as never);

      const s3 = {
        presignPut: jest.fn().mockResolvedValue({ url: 'https://put', expiresAt: 'x' }),
        headObject: jest.fn(),
      };
      const producer = { enabled: true, enqueueTranscode: jest.fn().mockResolvedValue(undefined) };
      const service = new UploadService(
        contents as never,
        workflow as never,
        assets,
        s3 as never,
        producer as never,
        prismaForAssets,
      );
      const ext = 'mp4'; // 재현하려는 결함 경로가 '같은 확장자 재시도'라 확장자를 고정한다
      const fileName = `clip.${ext}`;
      const mimeType = 'video/mp4';
      const getContentStatus = () => contentStatus;
      // findOriginal이 정말로 아무것도 못 찾는 경우(자산 행 부재·경합)를 재현하기 위한 훅 —
      // assets.findOriginal은 이제 실 메서드라 jest.fn()으로 mock override할 수 없다. 대신
      // 실 deleteMany로 저장소 자체를 비운다(존재하지 않는 storageKey를 `not` 조건으로 줘서
      // 전건 삭제 — 실제 Prisma deleteMany 의미 그대로).
      const wipeOriginalAssets = () =>
        prismaForAssets.mediaAsset.deleteMany({
          where: { contentId: 'c-1', kind: 'original', generation: 1, storageKey: { not: '__none__' } },
        });
      return {
        service,
        assets,
        workflow,
        s3,
        prisma: prismaForAssets,
        fileName,
        mimeType,
        getContentStatus,
        wipeOriginalAssets,
      };
    };

    it('같은 확장자 재시도: 1차 HEAD 부재 실패 → upload_failed → 2차 발급 → 2차 완료 성공', async () => {
      const { service, s3, getContentStatus, fileName, mimeType } = setupSequence();
      const user = reporterUser();

      // 1차 발급
      const issue1 = await service.issueUploadUrl(user, 'c-1', {
        contentId: 'c-1',
        fileName,
        mimeType,
        sizeBytes: 1000,
      } as never);
      expect(getContentStatus()).toBe('uploading');

      // 1차 완료 — HEAD 부재로 실패
      s3.headObject.mockResolvedValueOnce(null);
      await expectError(
        service.completeUpload(user, 'c-1', {
          contentId: 'c-1',
          storageKey: issue1.storageKey,
        } as never),
        'validation_failed',
      );
      expect(getContentStatus()).toBe('upload_failed'); // 교착 없음 — I-2

      // 2차 발급(같은 확장자 → 같은 storageKey)
      const issue2 = await service.issueUploadUrl(user, 'c-1', {
        contentId: 'c-1',
        fileName,
        mimeType,
        sizeBytes: 1000,
      } as never);
      expect(issue2.storageKey).toBe(issue1.storageKey); // 결함 경로 재현 조건: 같은 key
      expect(getContentStatus()).toBe('uploading');

      // 2차 완료 — 이번엔 HEAD 성공 → 정상 복구
      s3.headObject.mockResolvedValueOnce({ sizeBytes: 1000 });
      const result = await service.completeUpload(user, 'c-1', {
        contentId: 'c-1',
        storageKey: issue2.storageKey,
      } as never);
      expect(result.id).toBe('c-1');
      expect(getContentStatus()).toBe('uploaded');
    });

    it('어떤 실패 경로든(자산 부재·key 불일치·HEAD 부재) 콘텐츠는 uploading에 남지 않는다(I-2)', async () => {
      const { service, wipeOriginalAssets, getContentStatus, fileName, mimeType } = setupSequence();
      const user = reporterUser();

      await service.issueUploadUrl(user, 'c-1', {
        contentId: 'c-1',
        fileName,
        mimeType,
        sizeBytes: 1000,
      } as never);
      expect(getContentStatus()).toBe('uploading');

      // key 불일치 경로
      await expectError(
        service.completeUpload(user, 'c-1', {
          contentId: 'c-1',
          storageKey: 'contents/c-1/g1/evil.mp4',
        } as never),
        'validation_failed',
      );
      expect(getContentStatus()).not.toBe('uploading');

      // 재-issue로 복구 후, 이번엔 자산 자체가 없는 경우(findOriginal null)를 재현
      await service.issueUploadUrl(user, 'c-1', {
        contentId: 'c-1',
        fileName,
        mimeType,
        sizeBytes: 1000,
      } as never);
      await wipeOriginalAssets();
      await expectError(
        service.completeUpload(user, 'c-1', {
          contentId: 'c-1',
          storageKey: 'contents/c-1/g1/original.mp4',
        } as never),
        'validation_failed',
      );
      expect(getContentStatus()).not.toBe('uploading');
    });
  });
});
