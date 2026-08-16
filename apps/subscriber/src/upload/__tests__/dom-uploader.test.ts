import {
  createDomResidentUploader,
  toPickedVideo,
  UploadCanceledError,
  type DocumentLike,
  type FileInputLike,
  type FileLike,
  type ProgressEventLike,
  type XhrLike,
} from '../dom-uploader';
import { createResidentUploader } from '../uploader';

/**
 * 웹 업로더 어댑터 — DOM 없이 검증한다(T-W2-09).
 *
 * jest-expo는 **네이티브** 플랫폼으로 모듈을 해석하므로 `uploader.web.ts`는 이 스위트에서 절대
 * 로드되지 않는다. 그래서 로직은 `dom-uploader.ts`에 있고 DOM 의존성은 주입 대상이다.
 */

class FakeInput implements FileInputLike {
  type = '';
  accept = '';
  multiple = true;
  readonly style = { display: '' };
  files: ArrayLike<FileLike> | null = null;
  readonly attributes: Record<string, string> = {};
  removed = false;
  clicked = 0;
  private readonly handlers: Record<string, (() => void)[]> = {};

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  addEventListener(type: string, handler: () => void): void {
    (this.handlers[type] ??= []).push(handler);
  }
  click(): void {
    this.clicked += 1;
  }
  remove(): void {
    this.removed = true;
  }
  fire(type: string): void {
    (this.handlers[type] ?? []).forEach((h) => h());
  }
}

function fakeDoc(): { doc: DocumentLike; inputs: FakeInput[] } {
  const inputs: FakeInput[] = [];
  const doc: DocumentLike = {
    createElement: () => {
      const input = new FakeInput();
      inputs.push(input);
      return input;
    },
    body: { appendChild: () => undefined },
  };
  return { doc, inputs };
}

class FakeXhr implements XhrLike {
  static last: FakeXhr | null = null;
  readonly upload: { onprogress: ((e: ProgressEventLike) => void) | null } = { onprogress: null };
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  sentBody: unknown = null;
  aborted = false;

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  send(body: unknown): void {
    this.sentBody = body;
  }
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
}

const file = (over: Partial<FileLike> = {}): FileLike => ({
  name: 'clip.mp4',
  type: 'video/mp4',
  size: 1024,
  ...over,
});

function build() {
  const { doc, inputs } = fakeDoc();
  /** noUncheckedIndexedAccess 아래에서 인덱스 접근을 좁혀 준다(테스트 가독성 유지) */
  const input = (index: number): FakeInput => {
    const found = inputs[index];
    if (!found) throw new Error(`input[${index}]이 만들어지지 않았습니다`);
    return found;
  };
  return { uploader: createDomResidentUploader({ doc, XhrCtor: FakeXhr }), input };
}

describe('pickVideo', () => {
  it('동영상만 고르게 하고, camera 모드에서만 capture 속성을 붙인다', async () => {
    const { uploader, input } = build();

    const cameraPick = uploader.pickVideo('camera');
    input(0).files = [file()];
    input(0).fire('change');
    await cameraPick;
    expect(input(0).accept).toBe('video/*');
    expect(input(0).multiple).toBe(false);
    expect(input(0).attributes.capture).toBe('environment');

    const libraryPick = uploader.pickVideo('library');
    input(1).files = [file()];
    input(1).fire('change');
    await libraryPick;
    // library에 capture를 붙이면 iOS Safari가 보관함 선택지를 없앤다
    expect(input(1).attributes.capture).toBeUndefined();
  });

  it('선택 결과를 PickedVideo로 돌려주고 임시 input을 치운다', async () => {
    const { uploader, input } = build();
    const pending = uploader.pickVideo('library');
    input(0).files = [file({ name: '마을잔치.mov', type: 'video/quicktime', size: 4096 })];
    input(0).fire('change');

    const picked = await pending;
    expect(picked).toEqual({
      name: '마을잔치.mov',
      mimeType: 'video/quicktime',
      sizeBytes: 4096,
      body: expect.anything(),
    });
    expect(input(0).removed).toBe(true);
    expect(input(0).clicked).toBe(1);
  });

  it('취소(cancel 이벤트)는 null — 화면은 아무 일도 없었던 것처럼 둔다', async () => {
    const { uploader, input } = build();
    const pending = uploader.pickVideo('library');
    input(0).fire('cancel');
    await expect(pending).resolves.toBeNull();
  });

  it('파일 없이 change가 오면 null', async () => {
    const { uploader, input } = build();
    const pending = uploader.pickVideo('library');
    input(0).files = [];
    input(0).fire('change');
    await expect(pending).resolves.toBeNull();
  });
});

describe('toPickedVideo', () => {
  it('브라우저가 mimeType을 비워 보내면 video/mp4로 채운다(서버 zod는 video/ 접두를 요구한다)', () => {
    expect(toPickedVideo(file({ type: '' })).mimeType).toBe('video/mp4');
  });
});

describe('putVideo', () => {
  const video = { name: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 100, body: 'BYTES' };

  it('PUT + Content-Type만 붙이고 Authorization을 붙이지 않는다(서명이 URL에 있다)', async () => {
    const { uploader } = build();
    const pending = uploader.putVideo('https://storage.test/put?sig=abc', video, () => undefined);
    const xhr = FakeXhr.last as FakeXhr;
    xhr.status = 200;
    xhr.onload?.();
    await pending;

    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://storage.test/put?sig=abc');
    expect(xhr.headers).toEqual({ 'Content-Type': 'video/mp4' });
    expect(xhr.sentBody).toBe('BYTES');
  });

  it('진행률을 0..1로 보고하고 완료 시 1로 맞춘다', async () => {
    const { uploader } = build();
    const seen: number[] = [];
    const pending = uploader.putVideo('https://storage.test/put', video, (r) => seen.push(r));
    const xhr = FakeXhr.last as FakeXhr;
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 90, total: 0 });
    xhr.status = 204;
    xhr.onload?.();
    await pending;
    expect(seen).toEqual([0.5, 1]);
  });

  it('비2xx는 상태 코드만 알리고 서명 URL을 에러에 싣지 않는다', async () => {
    const { uploader } = build();
    const pending = uploader.putVideo('https://storage.test/put?sig=SECRET', video, () => undefined);
    const xhr = FakeXhr.last as FakeXhr;
    xhr.status = 403;
    xhr.onload?.();
    const err = await pending.catch((e: unknown) => e);
    expect((err as Error).message).toContain('403');
    expect((err as Error).message).not.toContain('SECRET');
  });

  it('멈추기(AbortSignal)는 UploadCanceledError — 화면이 에러 배너를 띄우지 않는 유일한 실패', async () => {
    const { uploader } = build();
    const controller = new AbortController();
    const pending = uploader.putVideo('https://storage.test/put', video, () => undefined, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(UploadCanceledError);
    expect((FakeXhr.last as FakeXhr).aborted).toBe(true);
  });

  it('이미 중단된 signal이면 전송을 시작조차 하지 않는다', async () => {
    const { uploader } = build();
    FakeXhr.last = null;
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploader.putVideo('https://storage.test/put', video, () => undefined, controller.signal),
    ).rejects.toBeInstanceOf(UploadCanceledError);
    expect(FakeXhr.last).toBeNull();
  });

  it('연결 실패·타임아웃도 사용자 문구로 올라온다', async () => {
    const { uploader } = build();
    const failing = uploader.putVideo('https://storage.test/put', video, () => undefined);
    (FakeXhr.last as FakeXhr).onerror?.();
    await expect(failing).rejects.toThrow('연결이 끊겼습니다');

    const timing = uploader.putVideo('https://storage.test/put', video, () => undefined);
    (FakeXhr.last as FakeXhr).ontimeout?.();
    await expect(timing).rejects.toThrow('시간이 너무 오래');
  });
});

describe('네이티브 해석 무회귀', () => {
  it('createResidentUploader()가 미지원 구현을 돌려준다(= DOM 코드가 네이티브 번들에 없다)', () => {
    const uploader = createResidentUploader();
    expect(uploader.supported).toBe(false);
    return expect(uploader.pickVideo('camera')).rejects.toThrow('웹 브라우저');
  });
});
