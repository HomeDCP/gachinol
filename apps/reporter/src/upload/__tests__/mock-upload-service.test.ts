import { toId } from '@gachinol/shared';
import type { ContentId } from '@gachinol/shared';
import { UploadAbortedError, mockUploadService } from '../mock-upload-service';
import type { UploadInput, UploadProgress } from '../upload-service';

const input: UploadInput = {
  contentId: toId<ContentId>('c1'),
  fileUri: 'file:///video.mp4',
  fileName: 'video.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 1000,
};

describe('mockUploadService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('진행률 단조 증가 0→1, storageKey 반환, 서버 호출 없음', async () => {
    const progresses: UploadProgress[] = [];
    const promise = mockUploadService.upload(input, (p) => progresses.push(p));

    await jest.advanceTimersByTimeAsync(4000);
    await expect(promise).resolves.toEqual({ storageKey: 'mock/contents/c1/original' });

    expect(progresses.length).toBeGreaterThan(1);
    for (let i = 1; i < progresses.length; i += 1) {
      expect(progresses[i]!.ratio).toBeGreaterThanOrEqual(progresses[i - 1]!.ratio);
    }
    expect(progresses.at(-1)?.ratio).toBe(1);
    expect(progresses.at(-1)?.loadedBytes).toBe(1000);
  });

  test('abort 즉시 중단 — UploadAbortedError, 이후 진행률 없음', async () => {
    const progresses: UploadProgress[] = [];
    const controller = new AbortController();
    const promise = mockUploadService.upload(input, (p) => progresses.push(p), controller.signal);
    const captured = promise.catch((e: unknown) => e);

    await jest.advanceTimersByTimeAsync(500); // 2틱 진행
    controller.abort();
    const count = progresses.length;
    await jest.advanceTimersByTimeAsync(4000);

    expect(await captured).toBeInstanceOf(UploadAbortedError);
    expect(progresses.length).toBe(count); // abort 이후 방출 없음
  });

  test('시작 전 aborted면 즉시 거부', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      mockUploadService.upload(input, () => {}, controller.signal),
    ).rejects.toBeInstanceOf(UploadAbortedError);
  });
});
