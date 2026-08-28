import type {
  CompleteUploadRequest,
  Content,
  ContentId,
  IssueUploadUrlRequest,
  IssueUploadUrlResponse,
} from '@gachinol/shared';
import type { ApiClient } from '../api/client';
import { UploadAbortedError } from './mock-upload-service';
import type { UploadInput, UploadProgress, UploadResult, UploadService } from './upload-service';

/* ══════════════════════════════════════════════════════════════════════════
 * 웹 업로더의 실제 로직 — **주입 가능한 XHR 의존성** (T-W2-02)
 *
 * `http-upload-service.web.ts`가 진짜 `XMLHttpRequest`·`fetch`를 주입해 이 팩토리를 부른다.
 * 로직을 여기 분리해 두는 이유는 **테스트 가능성**이다: jest-expo는 네이티브 플랫폼으로 모듈을
 * 해석해 `.web.ts`를 절대 로드하지 않으므로, 웹 어댑터의 동작(진행률 매핑·취소·실패 복구 통지)을
 * 검증하려면 DOM 없이 부를 수 있는 지점이 필요하다(구독자 `dom-uploader.ts` 선례와 동형).
 *
 * 아래 인터페이스는 DOM 타입의 **구조적 최소 부분집합**이다(`lib.dom` 참조 없이 타입이 서므로
 * 네이티브 타입체크에서도 안전하다).
 * ══════════════════════════════════════════════════════════════════════════ */

export interface ProgressEventLike {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
}

export interface XhrLike {
  readonly upload: { onprogress: ((e: ProgressEventLike) => void) | null };
  readonly status: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
}

/** 전송 본문의 구조적 최소 — 실측 크기만 있으면 된다(웹에선 Blob이 이 형태다) */
export interface BlobLike {
  readonly size: number;
}

export interface XhrUploadEnv {
  readonly XhrCtor: new () => XhrLike;
  /** `fileUri`(웹 픽커의 blob:·data:)를 전송 가능한 본문으로 해석한다. 실패 시 throw — ① 전이라 서버 무접촉. */
  resolveBody(uri: string): Promise<BlobLike>;
}

/**
 * ②·③ 실패/중단 후 서버측 복구 통지 — ①(upload-url)이 이미 draft|upload_failed→uploading을
 * 커밋했으므로, 그 뒤 실패하면 콘텐츠가 `uploading`에 갇혀 재발급(upload-url, `ISSUABLE=
 * ['draft','upload_failed']`)이 409로 막힌다(재시도 교착). 전용 "실패 통지" 엔드포인트는 없으므로,
 * HEAD 검증 실패 시 내부적으로 uploading→upload_failed로 되돌리는 **기존** `upload-complete`
 * 엔드포인트(services/api UploadService.completeUpload)를 그대로 재사용해 통지한다(신규 서버
 * 엔드포인트 없이 클라이언트만으로 해결 — 서버·shared는 이 태스크 소유 밖).
 * 이 통지 호출 자체의 실패(기대된 400 등)는 삼킨다 — 목적은 응답이 아니라 서버측 부수효과이고,
 * 호출부에는 원래 에러를 그대로 전파해야 한다(이 함수가 원래 에러를 가리면 안 된다).
 *
 * ★ 이 함수가 여기(웹 로직 파일)에 사는 이유: 네이티브(`http-upload-service.ts`)·웹(XHR) 두 어댑터가
 * 같은 복구 의미론을 공유해야 하는데(사본 금지), 웹 해석에서 `./http-upload-service`는
 * `http-upload-service.web.ts` **자신**이라 그쪽에 두면 순환이 된다(구독자 `uploader.web.ts`와
 * 동일 함정). 이 파일은 플랫폼 접미사가 없어 양쪽 해석에서 동일하다.
 */
export async function notifyUploadFailed(
  client: ApiClient,
  contentId: ContentId,
  storageKey: string,
): Promise<void> {
  try {
    await client.request<Content>('POST', `/contents/${contentId}/upload-complete`, {
      body: { contentId, storageKey } satisfies CompleteUploadRequest,
    });
  } catch {
    // 기대된 실패(오브젝트 HEAD 미검출 → 400) — 서버가 이미 그 경로에서 uploading→upload_failed를
    // 커밋했다. 이 catch는 통지 자체의 실패를 삼킬 뿐, 호출부의 원래 에러를 대체하지 않는다.
  }
}

/**
 * presigned PUT — `fetch` 대신 XHR을 쓰는 유일한 이유는 **업로드 진행률**이다(fetch에는 업로드
 * 진행 이벤트가 없다). 파일 바이트는 api를 거치지 않고 스토리지로 직행하며, 서명이 URL에
 * 들어 있으므로 Authorization 헤더를 붙이지 않는다.
 * ★ 에러 메시지에 상태 코드만 싣는다 — presigned URL(서명 포함)을 메시지에 넣지 않는다.
 */
function putWithXhr(
  env: XhrUploadEnv,
  uploadUrl: string,
  body: BlobLike,
  mimeType: string,
  sizeBytes: number,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }
    const xhr = new env.XhrCtor();
    let canceled = false;

    const onAbort = (): void => {
      canceled = true;
      xhr.abort();
    };
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort);

    xhr.upload.onprogress = (e) => {
      // 서버·프록시가 total을 안 주는 경우(lengthComputable=false)는 실측 본문 크기로 폴백한다
      const total = e.lengthComputable && e.total > 0 ? e.total : sizeBytes || 1;
      onProgress({
        loadedBytes: e.loaded,
        totalBytes: total,
        ratio: Math.min(e.loaded / total, 1),
      });
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        const total = sizeBytes || 1;
        onProgress({ loadedBytes: total, totalBytes: total, ratio: 1 });
        resolve();
        return;
      }
      reject(new Error(`업로드 전송 실패 (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('업로드 중 연결이 끊겼습니다'));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new Error('업로드에 시간이 너무 오래 걸립니다'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(canceled ? new UploadAbortedError() : new Error('업로드가 중단됐습니다'));
    };

    signal?.addEventListener('abort', onAbort);
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.send(body);
  });
}

/**
 * 실 업로드 구현(웹) — presigned PUT 3단계. 상태 전이(draft→uploading→uploaded)는 서버 몫.
 * ① POST /contents/:id/upload-url (IssueUploadUrlRequest → IssueUploadUrlResponse)
 * ② presigned PUT 파일 전송 (진행률·취소는 XHR `upload.onprogress`/`abort`)
 * ③ POST /contents/:id/upload-complete (CompleteUploadRequest → Content)
 *
 * 네이티브 구현(`http-upload-service.ts`)과 다른 점 하나: 본문(⓪)을 ①보다 **먼저** 읽는다.
 * 로컬 파일을 못 읽으면 서버 상태를 건드리지 않고 draft 그대로 실패시키기 위해서다(네이티브는
 * 전송 태스크가 읽기를 지연 수행해 이 순서를 가질 수 없다).
 */
export function createXhrUploadService(client: ApiClient, env: XhrUploadEnv): UploadService {
  return {
    async upload(
      input: UploadInput,
      onProgress: (p: UploadProgress) => void,
      signal?: AbortSignal,
    ): Promise<UploadResult> {
      if (signal?.aborted) throw new UploadAbortedError();

      // ⓪ 본문 확보 — 실패 시 서버 무접촉(위 주석)
      const body = await env.resolveBody(input.fileUri);
      // 웹 픽커는 fileSize를 안 주는 경우가 있어(호출부 `asset.fileSize ?? 0`) 실측 Blob 크기를
      // 우선한다 — 서버 zod가 sizeBytes positive를 요구해 0이면 ①부터 400이다.
      const sizeBytes = body.size > 0 ? body.size : input.sizeBytes;

      // ① 업로드 URL 발급 — draft|upload_failed → uploading (서버 전이. 클라 전이 흉내 금지)
      const issued = await client.request<IssueUploadUrlResponse>(
        'POST',
        `/contents/${input.contentId}/upload-url`,
        {
          body: {
            contentId: input.contentId,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes,
          } satisfies IssueUploadUrlRequest,
        },
      );

      // ①이 성공한 이 시점부터 서버는 uploading을 커밋했다 — 아래에서 던지는 에러는 전부
      // notifyUploadFailed로 서버에 통지(재발급 가능 상태로 복구)한 뒤 원래 에러를 그대로 재전파한다.
      try {
        // ② presigned PUT — 진행률·취소
        await putWithXhr(env, issued.uploadUrl, body, input.mimeType, sizeBytes, onProgress, signal);

        // ③ 완료 통지 — uploading → uploaded + 트랜스코딩 인큐(서버)
        await client.request<Content>('POST', `/contents/${input.contentId}/upload-complete`, {
          body: {
            contentId: input.contentId,
            storageKey: issued.storageKey,
          } satisfies CompleteUploadRequest,
        });

        return { storageKey: issued.storageKey };
      } catch (err) {
        await notifyUploadFailed(client, input.contentId, issued.storageKey);
        throw err;
      }
    },
  };
}
