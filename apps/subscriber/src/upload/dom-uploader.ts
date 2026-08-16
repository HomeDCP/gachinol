import type { PickedVideo, PickSource, ResidentUploader } from './upload-contract';

/* ══════════════════════════════════════════════════════════════════════════
 * 웹 업로더의 실제 로직 — **주입 가능한 DOM 의존성** (T-W2-09)
 *
 * `uploader.web.ts`가 진짜 `document`·`XMLHttpRequest`를 주입해 이 팩토리를 부른다. 로직을 여기
 * 분리해 두는 이유는 **테스트 가능성**이다: jest-expo는 네이티브 플랫폼으로 모듈을 해석해
 * `uploader.web.ts`를 절대 로드하지 않으므로, 웹 어댑터의 동작(파일 필터·진행률·취소·HTTP 실패
 * 판정)을 검증하려면 DOM 없이 부를 수 있는 지점이 필요하다. 이 파일이 그 지점이다.
 *
 * 아래 인터페이스는 DOM 타입의 **구조적 최소 부분집합**이다(`lib.dom` 참조 없이 타입이 서므로
 * 네이티브 타입체크에서도 안전하다).
 * ══════════════════════════════════════════════════════════════════════════ */

export interface FileLike {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

export interface FileInputLike {
  type: string;
  accept: string;
  multiple: boolean;
  readonly style: { display: string };
  readonly files: ArrayLike<FileLike> | null;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: () => void, options?: { once?: boolean }): void;
  click(): void;
  remove(): void;
}

export interface DocumentLike {
  createElement(tag: 'input'): FileInputLike;
  readonly body: { appendChild(node: FileInputLike): void };
}

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

export interface DomUploadEnv {
  readonly doc: DocumentLike;
  readonly XhrCtor: new () => XhrLike;
}

/** 사용자가 업로드를 멈췄을 때 — 화면은 이것만 조용히 삼킨다(에러 배너를 띄우지 않는다) */
export class UploadCanceledError extends Error {
  constructor() {
    super('업로드를 멈췄습니다');
    this.name = 'UploadCanceledError';
  }
}

export function createDomResidentUploader(env: DomUploadEnv): ResidentUploader {
  return {
    supported: true,

    /**
     * 파일 선택 — 화면에 `<input>`을 렌더하지 않고 **임시로 만들어 클릭**한다.
     * react-native 트리에 DOM 엘리먼트를 섞지 않기 위해서다(네이티브 렌더러가 'input'을 모른다).
     *
     * 취소 처리: 최신 브라우저는 `cancel` 이벤트를 준다. 주지 않는 구형 브라우저에서는 이 Promise가
     * 해결되지 않는데, **화면은 선택 중에 아무것도 잠그지 않으므로**(스피너·모달 없음) 사용자는
     * 그냥 버튼을 다시 누르면 된다. 잠금이 있었다면 이 함정이 곧 죽은 화면이 됐을 것이다.
     */
    pickVideo(source: PickSource): Promise<PickedVideo | null> {
      const input = env.doc.createElement('input');
      input.type = 'file';
      // 브라우저 파일 선택기 자체가 동영상만 보여주게 한다(어르신이 잘못 고를 기회를 줄인다)
      input.accept = 'video/*';
      input.multiple = false;
      if (source === 'camera') {
        // 모바일에서 카메라 직행. library에서는 붙이지 않는다 — 붙이면 보관함 선택지가 사라진다
        input.setAttribute('capture', 'environment');
      }
      input.style.display = 'none';
      env.doc.body.appendChild(input);

      return new Promise<PickedVideo | null>((resolve) => {
        const settle = (value: PickedVideo | null): void => {
          input.remove();
          resolve(value);
        };
        input.addEventListener(
          'change',
          () => {
            const file = input.files && input.files.length > 0 ? input.files[0] : null;
            settle(file ? toPickedVideo(file) : null);
          },
          { once: true },
        );
        input.addEventListener('cancel', () => settle(null), { once: true });
        input.click();
      });
    },

    /**
     * presigned PUT — `fetch` 대신 XHR을 쓰는 유일한 이유는 **업로드 진행률**이다(fetch에는 업로드
     * 진행 이벤트가 없다). 파일 바이트는 api를 거치지 않고 스토리지로 직행하며, 서명이 URL에
     * 들어 있으므로 Authorization 헤더를 붙이지 않는다(붙일 토큰도 없다 — 무인증 표면).
     */
    putVideo(
      uploadUrl: string,
      video: PickedVideo,
      onProgress: (ratio: number) => void,
      signal?: AbortSignal,
    ): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new UploadCanceledError());
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
          if (!e.lengthComputable || e.total <= 0) return;
          onProgress(Math.min(e.loaded / e.total, 1));
        };
        xhr.onload = () => {
          cleanup();
          if (xhr.status >= 200 && xhr.status < 300) {
            onProgress(1);
            resolve();
            return;
          }
          // ★ 상태 코드만 싣는다 — presigned URL(서명 포함)을 에러 메시지에 넣지 않는다
          reject(new Error(`영상을 보내지 못했습니다 (HTTP ${xhr.status})`));
        };
        xhr.onerror = () => {
          cleanup();
          reject(new Error('영상을 보내는 중 연결이 끊겼습니다'));
        };
        xhr.ontimeout = () => {
          cleanup();
          reject(new Error('영상을 보내는 데 시간이 너무 오래 걸립니다'));
        };
        xhr.onabort = () => {
          cleanup();
          reject(canceled ? new UploadCanceledError() : new Error('영상 보내기가 중단됐습니다'));
        };

        signal?.addEventListener('abort', onAbort);
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', video.mimeType);
        xhr.send(video.body);
      });
    },
  };
}

/** 브라우저가 mimeType을 비워 보내는 경우(일부 안드로이드)가 있어 기본값을 둔다 — 서버 zod는 `video/` 접두를 요구한다 */
export function toPickedVideo(file: FileLike): PickedVideo {
  return {
    name: file.name,
    mimeType: file.type && file.type.length > 0 ? file.type : 'video/mp4',
    sizeBytes: file.size,
    body: file,
  };
}
