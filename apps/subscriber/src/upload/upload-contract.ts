/* ══════════════════════════════════════════════════════════════════════════
 * 주민 업로드의 **파일 선택·전송 계약** — 플랫폼 중립 (T-W2-09)
 *
 * ── 왜 이 앱이 업로더를 직접 갖는가 ────────────────────────────────────────
 * 기자 앱의 `HttpUploadService`는 `expo-file-system/legacy`의 `createUploadTask`에 **파일 URI**를
 * 넘기는 구현이라 **웹에서 동작하지 않는다**(react-native-web에는 이 모듈의 구현이 없고, 웹에는
 * 애초에 파일 URI 개념이 없다 — 브라우저가 주는 것은 `File` 객체다). 웹 업로드 어댑터를 만드는
 * T-W2-02는 **미착수**이며, 그 태스크의 소유는 `apps/reporter/**`라 여기서 쓸 수도 없다.
 *
 * 그래서 이 화면은 자기 어댑터를 갖는다. 신규 의존성은 **0**이다(`expo-image-picker`·
 * `expo-document-picker`를 넣으려면 `package.json`·`pnpm-lock.yaml`을 만져야 하는데 둘 다 이
 * 태스크의 파일 소유 밖이고 `pnpm-lock.yaml`은 준-공용 자산이다). 웹 구현은 순수 DOM
 * (`<input type="file">` + `XMLHttpRequest`)이라 의존성이 필요 없다.
 *
 * ── 플랫폼 분리 방식 ──────────────────────────────────────────────────────
 * `uploader.ts`(기본=네이티브, 미지원) / `uploader.web.ts`(웹, DOM 구현) 확장자 분리다 —
 * 리포의 `hls-video.tsx`/`hls-video.web.tsx`·`register-service-worker.ts`/`.web.ts`와 동형.
 * `Platform.OS === 'web'` 런타임 분기보다 강한 보장이다(웹 코드가 네이티브 번들에 아예 없다).
 * 이 파일에는 **양쪽이 공유하는 타입과 문구만** 둔다 — `uploader.web.ts`가 `./uploader`를 import
 * 하면 웹 해석에서 자기 자신으로 순환하기 때문이다.
 * ══════════════════════════════════════════════════════════════════════════ */

/** 선택된 영상 1건 — `body`는 전송 본체(웹 `File`)이며 화면 코드는 절대 열어보지 않는다 */
export interface PickedVideo {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly body: unknown;
}

/**
 * 어디서 고르는가.
 * - `camera`: `<input capture="environment">` — 모바일에서 카메라가 바로 열린다(03 §C-5 "촬영 → 바로 업로드")
 * - `library`: 이미 찍어 둔 영상을 고른다(주민이 행사 중 찍고 나중에 올리는 실제 동선)
 * 두 버튼을 모두 두는 이유: `capture`가 붙으면 iOS Safari는 **보관함 선택지를 아예 없앤다**.
 */
export type PickSource = 'camera' | 'library';

export interface ResidentUploader {
  /** false면 화면은 업로드 UI를 렌더하지 않고 정직한 안내만 보여준다 */
  readonly supported: boolean;
  /** 사용자가 취소하면 null. 취소를 알 수 없는 구형 브라우저에서는 그냥 해결되지 않는다(화면은 막히지 않는다) */
  pickVideo(source: PickSource): Promise<PickedVideo | null>;
  /** presigned PUT 전송. `onProgress`는 0..1. 실패는 throw */
  putVideo(
    uploadUrl: string,
    video: PickedVideo,
    onProgress: (ratio: number) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}

/**
 * 네이티브(Expo Go·쉘 밖)에서 이 화면이 열렸을 때의 안내.
 * 주민 링크는 문자·카톡으로 오는 **URL**이라 실제 사용자는 항상 브라우저(또는 쉘 웹뷰)로 들어온다 —
 * 이 분기는 개발 중 Expo Go 실행처럼 사실상 도달하지 않는 경로이며, 도달해도 크래시 대신 안내를 준다.
 */
export const UNSUPPORTED_UPLOAD_NOTICE =
  '이 화면은 웹 브라우저에서 열어 주세요. 문자나 카카오톡으로 받은 링크를 그대로 누르시면 됩니다.';

/** 업로드가 불가능한 플랫폼의 구현 — 호출되면 조용히 실패하지 않고 명시적으로 알린다 */
export function createUnsupportedUploader(): ResidentUploader {
  return {
    supported: false,
    pickVideo: () => Promise.reject(new Error(UNSUPPORTED_UPLOAD_NOTICE)),
    putVideo: () => Promise.reject(new Error(UNSUPPORTED_UPLOAD_NOTICE)),
  };
}
