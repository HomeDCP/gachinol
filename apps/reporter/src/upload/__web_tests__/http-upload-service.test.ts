// apps/reporter/src/upload/__web_tests__/http-upload-service.test.ts
//
// 해소 판정 A(QUEUE 2-2, 대장 #178) — **접미사 없는 import**(`from '../http-upload-service'`)가
// 웹 jest 프로젝트(jest.web.config.js, `test:web` 스크립트)에서 `http-upload-service.web.ts`로
// 해석되는 것을 실행으로 증명한다. `from '../http-upload-service.web'`처럼 명시 경로를 쓰면 플랫폼
// 해석이 여전히 ios인 채로도 통과해버려 판정을 충족하지 못한다(위임문 §A) — 그래서 아래 import는
// 반드시 접미사가 없다.
//
// ── 구별 신호를 고르는 이유 ──────────────────────────────────────────────────────
// 네이티브 구현(`http-upload-service.ts`)은 `expo-file-system/legacy`의 `createUploadTask`로
// 업로드하고 `XMLHttpRequest`를 절대 참조하지 않는다. 웹 구현(`http-upload-service.web.ts`)은
// `typeof XMLHttpRequest`/`typeof fetch`를 직접 검사한 뒤 `xhr-upload-service.ts`의
// `createXhrUploadService`(실 XHR 기반 PUT)에 위임한다. 그래서 "주입한 가짜 XMLHttpRequest가
// 실제로 생성자 호출되고 PUT을 열었는가"는 네이티브 경로에서는 **원리적으로 발생할 수 없는**
// 신호다 — 두 구현이 우연히 같은 결과를 내서 오검출될 여지가 없다.
import { toId } from '@gachinol/shared';
import type { ContentId, CreateMultipartUploadResponse } from '@gachinol/shared';
import type { ApiClient } from '../../api/client';
// ⚠️ 접미사 없음 — 네이티브 jest.config.js에서는 http-upload-service.ts로, 이 웹 jest.web.config.js
// 에서는 http-upload-service.web.ts로 해석돼야 한다(haste.platforms=['web'] + moduleFileExtensions
// 가 web.ts를 최우선으로 둔다).
import { createHttpUploadService } from '../http-upload-service';
import type { UploadInput } from '../upload-service';
// 접미사 없는 파일(플랫폼 중립) — 양쪽 jest 축에서 동일 파일로 해석된다. 대장 #211 보완 2 —
// 임계값을 여기서도 가져와 "정확히 이 값을 넘는" 입력으로 웹 해석 경로에서 멀티파트 분기가
// 실제로 도는지 실행 증거를 남긴다(그동안 이 축은 999바이트 소형 파일만 다뤄 단일 PUT만 탔다).
import { MULTIPART_THRESHOLD_BYTES } from '../xhr-upload-service';

/** beforeEach마다 비우고, FakeXhr 생성자가 자신을 push한다(construct 시점의 마지막 인스턴스 추적용) */
const createdXhrs: FakeXhr[] = [];

/** 웹 XHR 최소 목 — xhr-upload-service.ts의 XhrLike 구조적 최소 부분집합을 실제로 흉내낸다. */
class FakeXhr {
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  status = 200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  openCalls: { method: string; url: string }[] = [];
  sentBodies: unknown[] = [];
  /** 멀티파트 파트 PUT이 읽는다 — 이 목은 모든 인스턴스에 고정 ETag를 응답한다(한 바퀴 완주가 목적) */
  private readonly responseHeaders: Record<string, string> = { ETag: '"webtag"' };

  constructor() {
    createdXhrs.push(this);
  }
  open(method: string, url: string): void {
    this.openCalls.push({ method, url });
  }
  setRequestHeader(): void {}
  send(body: unknown): void {
    this.sentBodies.push(body);
    // 동기적으로 성공 완료 — 마이크로태스크 큐를 굳이 빌리지 않는다(테스트 단순화)
    this.onload?.();
  }
  abort(): void {}
  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name] ?? null;
  }
}

/**
 * 실 바이트를 담지 않는 최소 Blob 스텁 — `size`와 `slice(start,end)`만 있으면 된다
 * (xhr-upload-service.ts의 `BlobLike` 구조적 최소). 실제 64MiB 버퍼를 할당하지 않아 메모리를
 * 낭비하지 않는다(대장 #211 보완 2 요구사항).
 */
function bigBlobStub(size: number): { size: number; slice(start: number, end: number): unknown } {
  return {
    size,
    slice(start: number, end: number) {
      return bigBlobStub(Math.max(0, Math.min(end, size) - Math.max(0, start)));
    },
  };
}

const input: UploadInput = {
  contentId: toId<ContentId>('c1'),
  fileUri: 'blob:http://localhost/fake-video',
  fileName: 'video.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 999,
};

function makeClient(uploadUrl: string, storageKey: string): { client: ApiClient; request: jest.Mock } {
  const request = jest.fn(async (_method: string, path: string) => {
    if (path.endsWith('/upload-url')) {
      return { uploadUrl, storageKey, expiresAt: '2026-09-11T00:00:00.000Z' };
    }
    // upload-complete
    return { id: 'c1', status: 'uploaded' };
  });
  const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
  return { client, request };
}

let originalXhr: unknown;
let originalFetch: unknown;

beforeEach(() => {
  originalXhr = (globalThis as Record<string, unknown>).XMLHttpRequest;
  originalFetch = (globalThis as Record<string, unknown>).fetch;
  createdXhrs.length = 0;

  (globalThis as Record<string, unknown>).XMLHttpRequest = FakeXhr;
  (globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
    ok: true,
    blob: async () => ({ size: input.sizeBytes }),
  }));
});

afterEach(() => {
  (globalThis as Record<string, unknown>).XMLHttpRequest = originalXhr;
  (globalThis as Record<string, unknown>).fetch = originalFetch;
});

test('[해소 판정 A / 직접 증거] require.resolve("../http-upload-service")가 실제로 .web.ts 절대경로를 반환한다', () => {
  // 동작 추론이 아니라 jest-resolve가 실제로 고른 파일의 절대경로 그 자체 — import 문과 동일한
  // 해석기(react-native/jest/resolver.js, haste.platforms=['web'])를 거친다(babel-jest가 ESM
  // import를 CJS require로 내리므로 동일 경로). 콘솔에 남겨 실행 로그로도 증명한다.
  // (require-imports·no-console 둘 다 이 워크스페이스 eslint에서 테스트 파일에 별도 disable이
  // 필요 없다 — base.mjs가 테스트 파일 전역에서 no-require-imports를 이미 끄고, no-console은
  // 애초에 어느 프리셋에도 켜져 있지 않다. 여기 넣으면 reportUnusedDisableDirectives가 잡는다.)
  // react-native/src/types/globals.d.ts의 NodeRequire는 `(id: string): any`만 선언한다(Metro
  // 런타임 제약 반영) — resolve가 타입에 없을 뿐 jest 실행 환경(Node)에는 실재한다. 캐스팅으로
  // 그 실재를 그대로 호출한다.
  const resolved = (require as unknown as { resolve(id: string): string }).resolve(
    '../http-upload-service',
  );
  console.log(`[해소 판정 A] resolve("../http-upload-service") -> ${resolved}`);
  expect(resolved.endsWith('/http-upload-service.web.ts')).toBe(true);
});

test('[해소 판정 A] "../http-upload-service"(접미사 없음)는 웹 축에서 .web.ts로 해석돼 XHR 기반 PUT을 사용한다', async () => {
  const { client, request } = makeClient('https://s3.example/put?sig=abc', 'contents/c1/g1/original.mp4');

  const svc = createHttpUploadService(client);
  const result = await svc.upload(input, () => {});

  expect(result).toEqual({ storageKey: 'contents/c1/g1/original.mp4' });

  // .web.ts 고유 경로 증거 — 네이티브 http-upload-service.ts는 XMLHttpRequest를 만들지도,
  // 'PUT'으로 열지도 않는다(expo-file-system.createUploadTask를 쓴다). 이 어서션이 통과한다는
  // 것 자체가 "접미사 없는 import가 .web.ts로 해석됐다"는 실행 증거다.
  expect(createdXhrs).toHaveLength(1);
  expect(createdXhrs[0]?.openCalls).toEqual([{ method: 'PUT', url: 'https://s3.example/put?sig=abc' }]);

  // upload-url → upload-complete 순서 자체는 두 구현이 공유하는 계약이라 구별 신호는 아니지만,
  // 웹 경로가 실제로 서버 왕복까지 완주했음을 함께 확인한다.
  expect(request).toHaveBeenNthCalledWith(1, 'POST', '/contents/c1/upload-url', {
    body: { contentId: 'c1', fileName: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 999 },
  });
  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/contents/c1/upload-complete', {
    body: { contentId: 'c1', storageKey: 'contents/c1/g1/original.mp4' },
  });
});

test('[대장 #211 보완 2] 임계 초과 입력 — 웹 해석 경로(.web.ts)에서 멀티파트 분기가 실제로 완주한다', async () => {
  // 임계값을 정확히 넘는 크기 — 실제 64MiB 버퍼는 만들지 않고 size만 큰 스텁을 쓴다(메모리 무낭비).
  const bigInput: UploadInput = { ...input, contentId: toId<ContentId>('c2'), sizeBytes: 0 };
  const totalSize = MULTIPART_THRESHOLD_BYTES + 100;
  const parts: CreateMultipartUploadResponse['parts'] = [
    { partNumber: 1, uploadUrl: 'https://s3.example/part1?sig=P1', sizeBytes: MULTIPART_THRESHOLD_BYTES },
    { partNumber: 2, uploadUrl: 'https://s3.example/part2?sig=P2', sizeBytes: 100 },
  ];
  const startedResponse: CreateMultipartUploadResponse = {
    storageKey: 'contents/c2/g1/original.mp4',
    uploadId: 'upload-web-1',
    partSizeBytes: MULTIPART_THRESHOLD_BYTES,
    parts,
    expiresAt: '2026-09-13T00:15:00.000Z',
  };

  // 이 테스트 전용 fetch(⓪ 본문 확보) — 전역 beforeEach의 999바이트 대신 임계 초과 스텁을 돌려준다.
  (globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
    ok: true,
    blob: async () => bigBlobStub(totalSize),
  }));

  const request = jest.fn(async (_method: string, path: string) => {
    if (path.endsWith('/multipart-upload')) return startedResponse;
    if (path.endsWith('/multipart-upload-complete')) return { id: 'c2', status: 'uploaded' };
    throw new Error(`예상 밖 라우트 호출: ${path}`);
  });
  const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;

  const svc = createHttpUploadService(client);
  const result = await svc.upload(bigInput, () => {});

  expect(result).toEqual({ storageKey: 'contents/c2/g1/original.mp4' });

  // 파트 절단 — 웹 해석 경로에서도 parts[].sizeBytes 경계와 정확히 일치한다
  const partXhrs = createdXhrs.filter((x) => x.openCalls[0]?.url.includes('/part'));
  expect(partXhrs).toHaveLength(2);
  expect(partXhrs[0]?.sentBodies[0]).toEqual(expect.objectContaining({ size: MULTIPART_THRESHOLD_BYTES }));
  expect(partXhrs[1]?.sentBodies[0]).toEqual(expect.objectContaining({ size: 100 }));

  // ETag 수집 + 완료 호출 — 단일 PUT과 다른 라우트(멱등: upload-url이 아니라 multipart-upload)
  expect(request).toHaveBeenNthCalledWith(
    1,
    'POST',
    '/contents/c2/multipart-upload',
    expect.objectContaining({ body: expect.objectContaining({ contentId: 'c2', sizeBytes: totalSize }) }),
  );
  expect(request).toHaveBeenNthCalledWith(2, 'POST', '/contents/c2/multipart-upload-complete', {
    body: {
      contentId: 'c2',
      storageKey: 'contents/c2/g1/original.mp4',
      uploadId: 'upload-web-1',
      parts: [
        { partNumber: 1, eTag: '"webtag"' },
        { partNumber: 2, eTag: '"webtag"' },
      ],
    },
  });
});

test('XMLHttpRequest·fetch 전역이 없으면(이례적 웹 런타임) 정직한 실패로 떨어진다 — .web.ts 고유 분기', async () => {
  delete (globalThis as Record<string, unknown>).XMLHttpRequest;
  delete (globalThis as Record<string, unknown>).fetch;

  const { client, request } = makeClient('https://s3.example/put', 'k1');
  const svc = createHttpUploadService(client);

  await expect(svc.upload(input, () => {})).rejects.toThrow('이 환경에서는 업로드를 지원하지 않습니다');
  // 서버 무접촉 — 네이티브 구현이었다면 애초에 이 메시지 자체가 존재하지 않는다
  // (http-upload-service.ts에는 이 한국어 문자열이 없다 — grep으로 재확인 가능).
  expect(request).not.toHaveBeenCalled();
});
