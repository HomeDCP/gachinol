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

test('전송 중 abort → cancelAsync 호출 + UploadAbortedError, 완료 미호출', async () => {
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
  // upload-url(1회)만, upload-complete 미호출
  expect(request).toHaveBeenCalledTimes(1);
});

test('비2xx PUT → 에러 전파, upload-complete 미호출', async () => {
  const { client, request } = makeClient();
  FileSystem.createUploadTask.mockImplementation(() => ({
    uploadAsync: async () => ({ status: 403 }),
    cancelAsync: jest.fn(async () => undefined),
  }));

  const svc = createHttpUploadService(client);
  await expect(svc.upload(input, () => {})).rejects.toThrow(/403/);
  expect(request).toHaveBeenCalledTimes(1); // upload-url만
});
