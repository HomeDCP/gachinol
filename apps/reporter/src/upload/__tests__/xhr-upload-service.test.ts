import { toId } from '@gachinol/shared';
import type { Content, ContentId, IssueUploadUrlResponse } from '@gachinol/shared';
import type { ApiClient } from '../../api/client';
import { UploadAbortedError } from '../mock-upload-service';
import type { UploadInput, UploadProgress } from '../upload-service';
import {
  createXhrUploadService,
  type BlobLike,
  type ProgressEventLike,
  type XhrLike,
} from '../xhr-upload-service';

const input: UploadInput = {
  contentId: toId<ContentId>('c1'),
  fileUri: 'blob:https://reporter.example/abc',
  fileName: 'video.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 1000,
};

const issued: IssueUploadUrlResponse = {
  storageKey: 'contents/c1/g1/original.mp4',
  uploadUrl: 'https://s3.example/put?sig=SECRET',
  expiresAt: '2026-08-28T00:15:00.000Z',
};

const fakeContent = { id: 'c1', status: 'uploaded' } as unknown as Content;

/** ① upload-url → ③(또는 실패 통지) 순서로 응답하는 ApiClient 모의 */
function makeClient(): { client: ApiClient; request: jest.Mock } {
  const request = jest
    .fn()
    .mockResolvedValueOnce(issued) // ① upload-url
    .mockResolvedValueOnce(fakeContent); // ③ upload-complete (실패 경로에선 통지가 이 자리를 씀)
  const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
  return { client, request };
}

/** 구조적 XhrLike 가짜 — 테스트가 이벤트를 수동 발화한다 */
class FakeXhr implements XhrLike {
  static instances: FakeXhr[] = [];
  readonly upload: { onprogress: ((e: ProgressEventLike) => void) | null } = { onprogress: null };
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  opened: [string, string] | null = null;
  headers: Record<string, string> = {};
  sentBody: unknown = undefined;
  abortCalls = 0;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string): void {
    this.opened = [method, url];
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  send(body: unknown): void {
    this.sentBody = body;
  }
  abort(): void {
    this.abortCalls += 1;
    this.onabort?.();
  }

  emitProgress(loaded: number, total: number, lengthComputable = true): void {
    this.upload.onprogress?.({ lengthComputable, loaded, total });
  }
  respond(status: number): void {
    this.status = status;
    this.onload?.();
  }
}

const blob = (size: number): BlobLike => ({ size });

function makeEnv(resolved: BlobLike | Error = blob(1000)): {
  XhrCtor: new () => XhrLike;
  resolveBody: jest.Mock;
} {
  return {
    XhrCtor: FakeXhr,
    resolveBody:
      resolved instanceof Error
        ? jest.fn().mockRejectedValue(resolved)
        : jest.fn().mockResolvedValue(resolved),
  };
}

beforeEach(() => {
  FakeXhr.instances = [];
});

test('성공 경로 — ① 바디·② XHR PUT(진행률 매핑)·③ 완료 통지·storageKey 반환', async () => {
  const { client, request } = makeClient();
  const env = makeEnv(blob(1000));
  const svc = createXhrUploadService(client, env);

  const progresses: UploadProgress[] = [];
  const promise = svc.upload(input, (p) => progresses.push(p));

  // XHR이 만들어질 때까지 마이크로태스크 소진 후 이벤트 발화
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  const xhr = FakeXhr.instances[0]!;
  xhr.emitProgress(500, 1000);
  xhr.respond(200);

  const result = await promise;
  expect(result).toEqual({ storageKey: issued.storageKey });

  // ① 바디 — 호출부 sizeBytes를 그대로 쓰지 않고 실 Blob 크기를 우선한다
  expect(request).toHaveBeenNthCalledWith(1, 'POST', '/contents/c1/upload-url', {
    body: { contentId: 'c1', fileName: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 1000 },
  });
  // ② PUT 배선 — URL·Content-Type·본문
  expect(xhr.opened).toEqual(['PUT', issued.uploadUrl]);
  expect(xhr.headers['Content-Type']).toBe('video/mp4');
  expect(xhr.sentBody).toEqual(blob(1000));
  // ③ 완료 통지
  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/contents/c1/upload-complete', {
    body: { contentId: 'c1', storageKey: issued.storageKey },
  });
  // 진행률 — 이벤트 매핑 + 성공 시 최종 1.0 보장
  expect(progresses[0]).toEqual({ loadedBytes: 500, totalBytes: 1000, ratio: 0.5 });
  expect(progresses[progresses.length - 1]!.ratio).toBe(1);
});

test('sizeBytes 폴백 — 호출부가 0을 줘도 Blob 실측 크기로 ①을 보낸다 (서버 zod positive)', async () => {
  const { client, request } = makeClient();
  const env = makeEnv(blob(2048));
  const svc = createXhrUploadService(client, env);

  const promise = svc.upload({ ...input, sizeBytes: 0 }, () => {});
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  FakeXhr.instances[0]!.respond(200);
  await promise;

  expect(request).toHaveBeenNthCalledWith(
    1,
    'POST',
    '/contents/c1/upload-url',
    expect.objectContaining({ body: expect.objectContaining({ sizeBytes: 2048 }) }),
  );
});

test('진행률 total 미계산(lengthComputable=false) — Blob 크기로 폴백한다', async () => {
  const { client } = makeClient();
  const env = makeEnv(blob(1000));
  const svc = createXhrUploadService(client, env);

  const progresses: UploadProgress[] = [];
  const promise = svc.upload(input, (p) => progresses.push(p));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  const xhr = FakeXhr.instances[0]!;
  xhr.emitProgress(300, 0, false);
  xhr.respond(200);
  await promise;

  expect(progresses[0]).toEqual({ loadedBytes: 300, totalBytes: 1000, ratio: 0.3 });
});

test('HTTP 실패 — 상태코드만 노출(서명 URL 비유출) + 실패 통지 후 원에러 전파', async () => {
  const { client, request } = makeClient();
  const env = makeEnv(blob(1000));
  const svc = createXhrUploadService(client, env);

  const promise = svc.upload(input, () => {});
  const guarded = promise.catch((e: unknown) => e);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  FakeXhr.instances[0]!.respond(403);

  const err = (await guarded) as Error;
  expect(err.message).toContain('403');
  expect(err.message).not.toContain('SECRET'); // presigned 서명이 에러에 새면 안 된다
  // 실패 통지 — 기존 upload-complete 재사용(uploading 교착 해제), 원에러는 그대로
  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/contents/c1/upload-complete', {
    body: { contentId: 'c1', storageKey: issued.storageKey },
  });
});

test('네트워크 오류(onerror) — 실패 통지 후 전파, 통지 자체 실패는 삼킨다', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce(issued)
    .mockRejectedValueOnce(new Error('통지도 실패')); // 통지 실패가 원에러를 가리면 안 된다
  const client = { request } as unknown as ApiClient;
  const svc = createXhrUploadService(client, makeEnv(blob(1000)));

  const promise = svc.upload(input, () => {});
  const guarded = promise.catch((e: unknown) => e);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  FakeXhr.instances[0]!.onerror!();

  const err = (await guarded) as Error;
  expect(err.message).not.toContain('통지도 실패');
  expect(request).toHaveBeenCalledTimes(2);
});

test('사전 취소 — 서버·본문 읽기에 일절 접촉하지 않고 UploadAbortedError', async () => {
  const { client, request } = makeClient();
  const env = makeEnv(blob(1000));
  const svc = createXhrUploadService(client, env);

  const controller = new AbortController();
  controller.abort();

  await expect(svc.upload(input, () => {}, controller.signal)).rejects.toBeInstanceOf(
    UploadAbortedError,
  );
  expect(request).not.toHaveBeenCalled();
  expect(env.resolveBody).not.toHaveBeenCalled();
});

test('중도 취소 — xhr.abort() 호출 + UploadAbortedError + 실패 통지', async () => {
  const { client, request } = makeClient();
  const env = makeEnv(blob(1000));
  const svc = createXhrUploadService(client, env);

  const controller = new AbortController();
  const promise = svc.upload(input, () => {}, controller.signal);
  const guarded = promise.catch((e: unknown) => e);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(FakeXhr.instances).toHaveLength(1);
  controller.abort();

  const err = await guarded;
  expect(err).toBeInstanceOf(UploadAbortedError);
  expect(FakeXhr.instances[0]!.abortCalls).toBe(1);
  expect(request).toHaveBeenNthCalledWith(
    2,
    'POST',
    '/contents/c1/upload-complete',
    expect.anything(),
  );
});

test('본문 읽기 실패 — ①을 부르지 않아 서버 상태가 draft에 남는다', async () => {
  const { client, request } = makeClient();
  const env = makeEnv(new Error('파일을 읽을 수 없습니다'));
  const svc = createXhrUploadService(client, env);

  await expect(svc.upload(input, () => {})).rejects.toThrow('파일을 읽을 수 없습니다');
  expect(request).not.toHaveBeenCalled();
});
