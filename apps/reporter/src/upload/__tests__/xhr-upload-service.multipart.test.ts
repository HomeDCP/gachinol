// apps/reporter/src/upload/__tests__/xhr-upload-service.multipart.test.ts
//
// 대장 #211 클라이언트측 — 멀티파트 업로드 분기(단일 PUT vs 멀티파트) 동반 의무(D1) 테스트.
// 서버 계약(packages/shared/src/content/dto.ts, 커밋 41f93c6)이 정의한 3라우트
// (multipart-upload·-complete·-abort)를 클라이언트가 실제로 소비하는지를 검증한다.
import { toId } from '@gachinol/shared';
import type {
  Content,
  ContentId,
  CreateMultipartUploadResponse,
  MultipartUploadPart,
} from '@gachinol/shared';
import type { ApiClient } from '../../api/client';
import { UploadAbortedError } from '../mock-upload-service';
import type { UploadInput, UploadProgress } from '../upload-service';
import {
  createXhrUploadService,
  MULTIPART_THRESHOLD_BYTES,
  type BlobLike,
  type ProgressEventLike,
  type XhrLike,
} from '../xhr-upload-service';

/** 슬라이스된 하위 블롭도 같은 구조를 갖는 최소 BlobLike 가짜(__tests__/xhr-upload-service.test.ts와 동형) */
const blob = (size: number): BlobLike => ({
  size,
  slice(start: number, end: number): BlobLike {
    return blob(Math.max(0, Math.min(end, size) - Math.max(0, start)));
  },
});

/** 구조적 XhrLike 가짜 — getResponseHeader로 ETag를 실어 보낸다(테스트가 respond() 전에 설정) */
class FakeXhr implements XhrLike {
  static instances: FakeXhr[] = [];
  readonly upload: { onprogress: ((e: ProgressEventLike) => void) | null } = { onprogress: null };
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  opened: [string, string] | null = null;
  sentBody: BlobLike | undefined = undefined;
  abortCalls = 0;
  responseHeaders: Record<string, string> = {};
  /** 이 인스턴스에 setRequestHeader가 호출된 (name,value) 전부 — 파트 PUT은 비어 있어야 한다 */
  requestHeaders: [string, string][] = [];

  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string): void {
    this.opened = [method, url];
  }
  setRequestHeader(name: string, value: string): void {
    this.requestHeaders.push([name, value]);
  }
  send(body: unknown): void {
    this.sentBody = body as BlobLike;
  }
  abort(): void {
    this.abortCalls += 1;
    this.onabort?.();
  }
  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name] ?? null;
  }
  emitProgress(loaded: number, total = loaded, lengthComputable = true): void {
    this.upload.onprogress?.({ lengthComputable, loaded, total });
  }
  respond(status: number, eTag?: string): void {
    this.status = status;
    if (eTag !== undefined) this.responseHeaders['ETag'] = eTag;
    this.onload?.();
  }
}

const input: UploadInput = {
  contentId: toId<ContentId>('c1'),
  fileUri: 'blob:https://reporter.example/big',
  fileName: 'big.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 0, // 실측 Blob 크기가 우선이므로 무관(각 테스트가 body 크기로 결정)
};

const fakeContent = { id: 'c1', status: 'uploaded' } as unknown as Content;

/** 파트 2개(정확히 sizeBytes 합이 됨) — MULTIPART_THRESHOLD_BYTES 직후 값 사용 */
const TOTAL_SIZE = MULTIPART_THRESHOLD_BYTES + 100;
const PART_1_SIZE = MULTIPART_THRESHOLD_BYTES;
const PART_2_SIZE = 100;

const startedResponse: CreateMultipartUploadResponse = {
  storageKey: 'contents/c1/g1/original.mp4',
  uploadId: 'upload-1',
  partSizeBytes: MULTIPART_THRESHOLD_BYTES,
  parts: [
    { partNumber: 1, uploadUrl: 'https://s3.example/part1?sig=S1', sizeBytes: PART_1_SIZE },
    { partNumber: 2, uploadUrl: 'https://s3.example/part2?sig=S2', sizeBytes: PART_2_SIZE },
  ] satisfies readonly MultipartUploadPart[],
  expiresAt: '2026-09-13T00:15:00.000Z',
};

/** ① multipart-upload → ③ multipart-upload-complete(또는 실패 시 -abort) 순서로 응답 */
function makeMultipartClient(): { client: ApiClient; request: jest.Mock } {
  const request = jest
    .fn()
    .mockResolvedValueOnce(startedResponse) // ① multipart-upload
    .mockResolvedValueOnce(fakeContent); // ③ multipart-upload-complete (실패 경로에선 -abort가 이 자리)
  const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
  return { client, request };
}

function makeEnv(): { XhrCtor: new () => XhrLike; resolveBody: jest.Mock } {
  return { XhrCtor: FakeXhr, resolveBody: jest.fn() };
}

async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

beforeEach(() => {
  FakeXhr.instances = [];
});

test('임계 분기 — 정확히 임계값(경계)이면 단일 PUT(upload-url)을 탄다', async () => {
  const request = jest.fn().mockResolvedValueOnce({
    storageKey: 'k',
    uploadUrl: 'https://s3.example/put',
    expiresAt: '2026-09-13T00:00:00.000Z',
  });
  const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
  const env = makeEnv();
  env.resolveBody.mockResolvedValue(blob(MULTIPART_THRESHOLD_BYTES));
  const svc = createXhrUploadService(client, env);

  const promise = svc.upload(input, () => {});
  await flush(3);
  expect(FakeXhr.instances).toHaveLength(1); // 단일 PUT — 파트 XHR이 아니다
  FakeXhr.instances[0]!.respond(200);
  await promise;

  expect(request).toHaveBeenNthCalledWith(1, 'POST', '/contents/c1/upload-url', expect.anything());
});

test('임계 분기 — 임계값을 1바이트라도 넘으면 멀티파트(multipart-upload)를 탄다', async () => {
  const { client, request } = makeMultipartClient();
  const env = makeEnv();
  env.resolveBody.mockResolvedValue(blob(MULTIPART_THRESHOLD_BYTES + 1));
  const svc = createXhrUploadService(client, env);

  const promise = svc.upload(input, () => {});
  await flush(3);

  expect(request).toHaveBeenNthCalledWith(
    1,
    'POST',
    '/contents/c1/multipart-upload',
    expect.objectContaining({
      body: expect.objectContaining({
        contentId: 'c1',
        sizeBytes: MULTIPART_THRESHOLD_BYTES + 1,
      }),
    }),
  );

  // 정리 — 아직 파트 응답을 안 줬으므로 나머지는 다른 테스트가 이어받지 않도록 여기서 취소 처리
  const xhrs = [...FakeXhr.instances];
  xhrs.forEach((x) => x.respond(200, '"e"'));
  await promise;
});

test('파트 절단 — Blob.slice가 parts[].sizeBytes 경계와 정확히 일치한다', async () => {
  const { client } = makeMultipartClient();
  const env = makeEnv();
  env.resolveBody.mockResolvedValue(blob(TOTAL_SIZE));
  const svc = createXhrUploadService(client, env);

  const promise = svc.upload(input, () => {});
  await flush(4);

  // 동시성 2 · 파트 2개 — 둘 다 즉시(동기적으로) 열려 있어야 한다
  expect(FakeXhr.instances).toHaveLength(2);
  const [x1, x2] = FakeXhr.instances;
  expect(x1!.opened).toEqual(['PUT', 'https://s3.example/part1?sig=S1']);
  expect(x1!.sentBody!.size).toBe(PART_1_SIZE);
  expect(x2!.opened).toEqual(['PUT', 'https://s3.example/part2?sig=S2']);
  expect(x2!.sentBody!.size).toBe(PART_2_SIZE);
  // 파트 PUT은 Content-Type을 붙이지 않는다 — presignUploadPart가 서명에 포함하지 않는 헤더다
  expect(x1!.requestHeaders).toEqual([]);
  expect(x2!.requestHeaders).toEqual([]);

  x1!.respond(200, '"e1"');
  x2!.respond(200, '"e2"');
  await promise;
});

test('ETag 수집과 완료 호출 페이로드 — partNumber·eTag(따옴표 포함 그대로)가 정확히 전달된다', async () => {
  const { client, request } = makeMultipartClient();
  const env = makeEnv();
  env.resolveBody.mockResolvedValue(blob(TOTAL_SIZE));
  const svc = createXhrUploadService(client, env);

  const promise = svc.upload(input, () => {});
  await flush(4);
  const [x1, x2] = FakeXhr.instances;
  x1!.respond(200, '"aaa111"');
  x2!.respond(200, '"bbb222"');

  const result = await promise;
  expect(result).toEqual({ storageKey: startedResponse.storageKey });

  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/contents/c1/multipart-upload-complete', {
    body: {
      contentId: 'c1',
      storageKey: startedResponse.storageKey,
      uploadId: startedResponse.uploadId,
      // 따옴표를 벗기지 않는다 — S3 CompleteMultipartUpload는 UploadPart 응답과 정확히
      // 일치하는 문자열(따옴표 포함)을 요구한다.
      parts: [
        { partNumber: 1, eTag: '"aaa111"' },
        { partNumber: 2, eTag: '"bbb222"' },
      ],
    },
  });
});

test('ETag 누락 — 응답이 200이어도 ETag 헤더가 없으면 즉시 실패하고 완료 호출을 하지 않는다', async () => {
  const { client, request } = makeMultipartClient();
  const env = makeEnv();
  env.resolveBody.mockResolvedValue(blob(TOTAL_SIZE));
  const svc = createXhrUploadService(client, env);

  const promise = svc.upload(input, () => {});
  const guarded = promise.catch((e: unknown) => e);
  await flush(4);
  const [x1, x2] = FakeXhr.instances;
  x1!.respond(200); // ETag 없음
  x2!.respond(200, '"bbb"'); // 다른 파트는 정상 — 그래도 전체는 실패해야 한다

  const err = (await guarded) as Error;
  expect(err.message).toContain('ETag');
  // 완료 호출(주입된 두 번째 request 응답)은 쓰이지 않고, 대신 abort가 호출된다
  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/contents/c1/multipart-upload-abort', {
    body: {
      contentId: 'c1',
      storageKey: startedResponse.storageKey,
      uploadId: startedResponse.uploadId,
    },
  });
});

test('파트 HTTP 실패 — 실패 즉시 나머지 진행 중 파트를 중단하고 abort 라우트를 호출한다', async () => {
  const { client, request } = makeMultipartClient();
  const env = makeEnv();
  env.resolveBody.mockResolvedValue(blob(TOTAL_SIZE));
  const svc = createXhrUploadService(client, env);

  const promise = svc.upload(input, () => {});
  const guarded = promise.catch((e: unknown) => e);
  await flush(4);
  const [x1, x2] = FakeXhr.instances;
  x1!.respond(500); // 파트1 실패 — 파트2는 아직 진행 중(응답 안 줌)

  const err = (await guarded) as Error;
  expect(err.message).toContain('500');
  // 조기 취소 — 파트2 XHR도 abort() 호출을 받는다(내부 컨트롤러가 전파)
  expect(x2!.abortCalls).toBe(1);
  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/contents/c1/multipart-upload-abort', {
    body: {
      contentId: 'c1',
      storageKey: startedResponse.storageKey,
      uploadId: startedResponse.uploadId,
    },
  });
});

test('취소(signal) — 진행 중인 파트 XHR을 중단하고 abort 라우트를 호출한 뒤 UploadAbortedError', async () => {
  const { client, request } = makeMultipartClient();
  const env = makeEnv();
  env.resolveBody.mockResolvedValue(blob(TOTAL_SIZE));
  const svc = createXhrUploadService(client, env);

  const controller = new AbortController();
  const promise = svc.upload(input, () => {}, controller.signal);
  const guarded = promise.catch((e: unknown) => e);
  await flush(4);
  expect(FakeXhr.instances).toHaveLength(2);
  controller.abort();

  const err = await guarded;
  expect(err).toBeInstanceOf(UploadAbortedError);
  expect(FakeXhr.instances[0]!.abortCalls).toBe(1);
  expect(FakeXhr.instances[1]!.abortCalls).toBe(1);
  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/contents/c1/multipart-upload-abort', {
    body: {
      contentId: 'c1',
      storageKey: startedResponse.storageKey,
      uploadId: startedResponse.uploadId,
    },
  });
});

test('진행률 — 파트별 loaded 합산이 단조 비감소, 완료 시 정확히 1.0', async () => {
  const { client } = makeMultipartClient();
  const env = makeEnv();
  env.resolveBody.mockResolvedValue(blob(TOTAL_SIZE));
  const svc = createXhrUploadService(client, env);

  const progresses: UploadProgress[] = [];
  const promise = svc.upload(input, (p) => progresses.push(p));
  await flush(4);
  const [x1, x2] = FakeXhr.instances;

  x2!.emitProgress(50); // 파트2(작은 파트) 절반
  x1!.emitProgress(1000); // 파트1(큰 파트) 극히 일부
  x1!.emitProgress(2000); // 파트1 진행
  x2!.respond(200, '"e2"'); // 파트2 완료(잔여분까지 확정)
  x1!.respond(200, '"e1"'); // 파트1 완료

  await promise;

  expect(progresses.length).toBeGreaterThan(0);
  for (let i = 1; i < progresses.length; i += 1) {
    expect(progresses[i]!.loadedBytes).toBeGreaterThanOrEqual(progresses[i - 1]!.loadedBytes);
  }
  const last = progresses[progresses.length - 1]!;
  expect(last.loadedBytes).toBe(TOTAL_SIZE);
  expect(last.ratio).toBe(1);
});

test('진행률 — 같은 파트에서 loaded가 역행해도(비정상 XHR 이벤트) 합산 진행률은 뒤로 가지 않는다 (verifier 게이트②)', async () => {
  // 배경: partLoaded[i]를 클램프 없이 매번 덮어쓰면, 같은 XHR의 upload.onprogress가 역행하는
  // 이례적 이벤트(브라우저 관례상 통상 없지만 "보장"이라 적힌 주석을 코드가 강제하지 않던 문제,
  // 대장 #209류) 하나만으로 사용자에게 노출되는 합산 진행률이 뒤로 간다. 이 테스트는 그 역행을
  // 실제로 주입해 방어를 확인한다.
  const { client } = makeMultipartClient();
  const env = makeEnv();
  env.resolveBody.mockResolvedValue(blob(TOTAL_SIZE));
  const svc = createXhrUploadService(client, env);

  const progresses: UploadProgress[] = [];
  const promise = svc.upload(input, (p) => progresses.push(p));
  await flush(4);
  const [x1, x2] = FakeXhr.instances;

  x1!.emitProgress(50_000_000); // 파트1 — 정상 진행
  x1!.emitProgress(10_000_000); // 파트1 — 역행(비정상, 방어 대상)
  x2!.emitProgress(50);
  x2!.respond(200, '"e2"');
  x1!.respond(200, '"e1"'); // 파트1 완료 확정치(sizeBytes)

  await promise;

  expect(progresses.length).toBeGreaterThan(0);
  for (let i = 1; i < progresses.length; i += 1) {
    expect(progresses[i]!.loadedBytes).toBeGreaterThanOrEqual(progresses[i - 1]!.loadedBytes);
  }
  const last = progresses[progresses.length - 1]!;
  expect(last.loadedBytes).toBe(TOTAL_SIZE);
  expect(last.ratio).toBe(1);
});

test('작은 파일 무회귀 — 임계 이하는 여전히 단일 PUT 경로로 완주한다', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce({
      storageKey: 'contents/c1/g1/original.mp4',
      uploadUrl: 'https://s3.example/put?sig=abc',
      expiresAt: '2026-09-13T00:00:00.000Z',
    })
    .mockResolvedValueOnce(fakeContent);
  const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
  const env = makeEnv();
  env.resolveBody.mockResolvedValue(blob(1000));
  const svc = createXhrUploadService(client, env);

  const promise = svc.upload(input, () => {});
  await flush(3);
  expect(FakeXhr.instances).toHaveLength(1);
  FakeXhr.instances[0]!.respond(200);
  const result = await promise;

  expect(result).toEqual({ storageKey: 'contents/c1/g1/original.mp4' });
  expect(request).toHaveBeenNthCalledWith(1, 'POST', '/contents/c1/upload-url', expect.anything());
  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/contents/c1/upload-complete', expect.anything());
});
