import { toId } from '@gachinol/shared';
import type { Content, ContentId, IssueUploadUrlResponse } from '@gachinol/shared';
import type { ApiClient } from '../../api/client';
import { createHttpUploadService } from '../http-upload-service';
import { UploadAbortedError } from '../mock-upload-service';
import type { UploadInput, UploadProgress } from '../upload-service';

// expo-file-system/legacy 모의 — createUploadTask + FileSystemUploadType
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 'BINARY_CONTENT', MULTIPART: 'MULTIPART' },
  createUploadTask: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const FileSystem = require('expo-file-system/legacy') as {
  createUploadTask: jest.Mock;
  FileSystemUploadType: { BINARY_CONTENT: string };
};

const input: UploadInput = {
  contentId: toId<ContentId>('c1'),
  fileUri: 'file:///video.mp4',
  fileName: 'video.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 1000,
};

const issued: IssueUploadUrlResponse = {
  storageKey: 'contents/c1/g1/original.mp4',
  uploadUrl: 'https://s3.example/put?sig=abc',
  expiresAt: '2026-07-22T00:15:00.000Z',
};

const fakeContent = { id: 'c1', status: 'uploaded' } as unknown as Content;

/** 1차 upload-url → IssueUploadUrlResponse, 2차 upload-complete → Content 반환하는 ApiClient 모의 */
function makeClient(): { client: ApiClient; request: jest.Mock } {
  const request = jest
    .fn()
    .mockResolvedValueOnce(issued) // ① upload-url
    .mockResolvedValueOnce(fakeContent); // ③ upload-complete
  const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
  return { client, request };
}

beforeEach(() => {
  FileSystem.createUploadTask.mockReset();
});

test('업로드 URL 바디·presigned PUT·완료 통지 정확, storageKey 반환', async () => {
  const { client, request } = makeClient();
  FileSystem.createUploadTask.mockImplementation(
    (
      _url: string,
      _fileUri: string,
      _opts: unknown,
      cb: (d: { totalBytesSent: number; totalBytesExpectedToSend: number }) => void,
    ) => ({
      uploadAsync: async () => {
        cb({ totalBytesSent: 500, totalBytesExpectedToSend: 1000 });
        cb({ totalBytesSent: 1000, totalBytesExpectedToSend: 1000 });
        return { status: 200 };
      },
      cancelAsync: jest.fn(async () => undefined),
    }),
  );

  const progresses: UploadProgress[] = [];
  const svc = createHttpUploadService(client);
  const result = await svc.upload(input, (p) => progresses.push(p));

  expect(result).toEqual({ storageKey: issued.storageKey });

  // ① upload-url 바디
  expect(request).toHaveBeenNthCalledWith(1, 'POST', '/contents/c1/upload-url', {
    body: { contentId: 'c1', fileName: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 1000 },
  });
  // ② presigned PUT — uploadUrl·Content-Type
  const [url, fileUri, opts] = FileSystem.createUploadTask.mock.calls[0]!;
  expect(url).toBe(issued.uploadUrl);
  expect(fileUri).toBe(input.fileUri);
  expect((opts as { httpMethod: string }).httpMethod).toBe('PUT');
  expect((opts as { uploadType: string }).uploadType).toBe(
    FileSystem.FileSystemUploadType.BINARY_CONTENT,
  );
  expect((opts as { headers: Record<string, string> }).headers['Content-Type']).toBe('video/mp4');
  // ③ upload-complete — 발급 storageKey
  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/contents/c1/upload-complete', {
    body: { contentId: 'c1', storageKey: issued.storageKey },
  });

  // 진행률 단조 증가·최종 ratio=1
  expect(progresses.length).toBeGreaterThan(1);
  for (let i = 1; i < progresses.length; i += 1) {
    expect(progresses[i]!.ratio).toBeGreaterThanOrEqual(progresses[i - 1]!.ratio);
  }
  expect(progresses.at(-1)?.ratio).toBe(1);
});

test('시작 전 abort → UploadAbortedError, upload-url 미호출', async () => {
  const { client, request } = makeClient();
  const controller = new AbortController();
  controller.abort();
  const svc = createHttpUploadService(client);
  await expect(svc.upload(input, () => {}, controller.signal)).rejects.toBeInstanceOf(
    UploadAbortedError,
  );
  expect(request).not.toHaveBeenCalled();
  expect(FileSystem.createUploadTask).not.toHaveBeenCalled();
});

test('전송 중 abort → cancelAsync 호출 + UploadAbortedError + 서버에 실패 통지(upload-complete 재사용)', async () => {
  const { client, request } = makeClient();
  const controller = new AbortController();
  const cancelAsync = jest.fn(async () => undefined);
  FileSystem.createUploadTask.mockImplementation(() => ({
    uploadAsync: async () => {
      controller.abort(); // 전송 중 취소
      return null; // 취소 → 결과 없음
    },
    cancelAsync,
  }));

  const svc = createHttpUploadService(client);
  await expect(svc.upload(input, () => {}, controller.signal)).rejects.toBeInstanceOf(
    UploadAbortedError,
  );
  expect(cancelAsync).toHaveBeenCalled();
  // upload-url(①) + 실패 통지(notifyUploadFailed가 upload-complete를 재사용) = 2회.
  // makeClient()의 2번째 큐잉 값(fakeContent)이 그대로 소비되지만, 통지의 목적은 응답이 아니라
  // 서버측 uploading→upload_failed 부수효과이므로 성공 응답으로 와도 무방(호출 여부·인자만 검증).
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/contents/c1/upload-complete', {
    body: { contentId: 'c1', storageKey: issued.storageKey },
  });
});

test('비2xx PUT → 원래 에러(HTTP 403) 그대로 전파 + 서버에 실패 통지(upload-complete 재사용)', async () => {
  const { client, request } = makeClient();
  FileSystem.createUploadTask.mockImplementation(() => ({
    uploadAsync: async () => ({ status: 403 }),
    cancelAsync: jest.fn(async () => undefined),
  }));

  const svc = createHttpUploadService(client);
  await expect(svc.upload(input, () => {})).rejects.toThrow(/403/);
  expect(request).toHaveBeenCalledTimes(2); // upload-url(①) + 실패 통지(upload-complete 재사용)
  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/contents/c1/upload-complete', {
    body: { contentId: 'c1', storageKey: issued.storageKey },
  });
});

test('실패 통지(upload-complete) 자체가 거부돼도 원래 에러가 그대로 전파된다(통지 실패가 원래 에러를 가리지 않음)', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce(issued) // ① upload-url
    .mockRejectedValueOnce(new Error('object not found (기대된 400)')); // 실패 통지 — 서버 실제 응답 형태
  const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
  FileSystem.createUploadTask.mockImplementation(() => ({
    uploadAsync: async () => ({ status: 500 }),
    cancelAsync: jest.fn(async () => undefined),
  }));

  const svc = createHttpUploadService(client);
  // 통지(2번째 request)가 reject해도 던져지는 건 원래 PUT 실패(HTTP 500)다
  await expect(svc.upload(input, () => {})).rejects.toThrow(/500/);
  expect(request).toHaveBeenCalledTimes(2);
});

test('실패 후 재시도(두 번째 upload() 호출)가 409 없이 성공한다 — [다시 시도] 버튼과 동형 호출 패턴', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce(issued) // ①-1 upload-url (최초 시도)
    .mockRejectedValueOnce(new Error('object not found')) // 실패 통지(1차 실패 → 서버가 uploading→upload_failed로 복구)
    .mockResolvedValueOnce(issued) // ①-2 upload-url (재시도 — upload_failed는 ISSUABLE이라 409 없이 재발급)
    .mockResolvedValueOnce(fakeContent); // ③-2 upload-complete (재시도 — 성공)
  const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
  const svc = createHttpUploadService(client);

  // 1차 시도 — PUT 실패
  FileSystem.createUploadTask.mockImplementationOnce(() => ({
    uploadAsync: async () => ({ status: 500 }),
    cancelAsync: jest.fn(async () => undefined),
  }));
  await expect(svc.upload(input, () => {})).rejects.toThrow(/500/);

  // 2차 시도 — 같은 input으로 svc.upload 재호출("다시 시도" 버튼의 실제 호출 패턴), PUT 성공
  FileSystem.createUploadTask.mockImplementationOnce(() => ({
    uploadAsync: async () => ({ status: 200 }),
    cancelAsync: jest.fn(async () => undefined),
  }));
  const result = await svc.upload(input, () => {});

  expect(result).toEqual({ storageKey: issued.storageKey });
  expect(request).toHaveBeenCalledTimes(4);
  // 재시도의 upload-url 호출(3번째 request)이 정상 진행됐다 — mock이 409 없이 resolve하도록
  // 구성한 것 자체가 "1차 실패 통지 덕분에 서버가 재발급 가능 상태(upload_failed)로 복구됐다"는
  // 전제를 코드로 고정한다(서버 409 판정 로직 자체는 services/api 소유라 여기서 재검증하지 않는다).
  expect(request).toHaveBeenNthCalledWith(3, 'POST', '/contents/c1/upload-url', {
    body: { contentId: 'c1', fileName: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 1000 },
  });
});
