/* ══════════════════════════════════════════════════════════════════════════
 * 촬영 결과 계약 + 유령 미디어 방어 (대장 #173, 2026-09-11 조사자 실측)
 *
 * ── 발견된 결함 ──────────────────────────────────────────────────────────
 * `expo-camera`의 `CameraView.recordAsync()`는 **웹에서 `{ uri: '' }`만 반환한다**(throw 없이
 * `console.warn`만 — `expo-camera/src/ExpoCamera.web.tsx:110` "record is not supported on web").
 * 옛 `app/(app)/contents/new/index.tsx`는 이 빈 uri를 그대로 `sizeBytes: 0`과 함께 draft에 넣었고
 * (주석: "recordAsync는 크기를 주지 않음 — Mock 업로드라 무해" — Mock이던 시절 전제, 실업로드로 바뀐
 * 뒤에도 남아 있었다), 그 draft가 업로드 단계로 가면 웹 어댑터의 `fetch('')`가 **빈 문자열을 현재
 * SPA 페이지로 상대경로 해석**해 `res.ok=true`·HTML 셸 blob(size>0)을 돌려줬다 — 유령 영상이
 * 실제 영상인 것처럼 서버 zod(positive)까지 통과했다.
 *
 * ── 이 파일의 역할 ───────────────────────────────────────────────────────
 * ① 웹 촬영 — `CameraView`/`recordAsync` 대신 **이미 reporter 의존성인 expo-image-picker**의
 *    `launchCameraAsync`를 쓴다(신규 의존 0). 웹 해석에서 이 함수는 내부적으로
 *    `<input type="file" capture="camera">`를 만들어 클릭하는 DOM 코드다
 *    (`expo-image-picker/src/ExponentImagePicker.web.ts` `openFileBrowserAsync`) — 구독자
 *    `dom-uploader.ts`가 손으로 구현한 것과 **동일 메커니즘**을 라이브러리가 이미 제공하고,
 *    결과가 실제 `File`에서 온 `blob:` uri·정확한 `fileSize`라 애초에 ghost가 될 수 없다
 *    (reporter 자신의 `pickFromLibrary`가 이미 이 라이브러리로 같은 방식을 쓰고 있다 — 새 방식
 *    발명이 아니라 기존 패턴 재사용).
 * ② 네이티브 녹화 크기 — `CameraView.recordAsync()`는 네이티브에서는 uri를 정상 반환하지만
 *    **크기를 주지 않는다**(구 주석 그대로). 서버 zod가 `sizeBytes.positive()`를 요구하므로 0은
 *    업로드 첫 단계(upload-url)에서 400이었다 — 즉 네이티브 카메라 녹화도 실업로드 전환 후로는
 *    이미 깨져 있었다(원인이 다를 뿐 "촬영이 유령 영상을 만든다"의 네이티브 판). `expo-file-system`
 *    (이미 `http-upload-service.ts`가 쓰는 의존성)의 `getInfoAsync`로 녹화 직후 실측한다.
 * ③ 공통 방어(`assertRealCapturedVideo`) — 두 경로 중 어느 쪽 결과든 draft(`setMedia`)에 들어가기
 *    **전**에 빈 uri·0바이트·비디오가 아닌 mimeType을 막는다. `upload-service.ts`의
 *    `assertRealVideoInput`(두 업로드 어댑터가 공유하는 업로드 직전 공통 관문 — 단, 그쪽은 uri
 *    존재·mimeType만 보고 sizeBytes·URI 스킴은 안 본다. 정확한 검사 범위는 그 함수 주석 참조)과
 *    역할이 겹치지만 **의도적으로 둘 다 둔다**: 여기는 "사용자가 촬영 직후 즉시 알아볼 수 있는
 *    실패"를 주는 자리(draft가 애초에 더럽혀지지 않는다)이고, 그쪽은 업로드 시점에 같은 조건
 *    (uri·mimeType)을 다시 확인하는 관문이다.
 * ══════════════════════════════════════════════════════════════════════════ */

export interface CapturedVideo {
  uri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec?: number;
}

/** 촬영/녹화 결과가 유령 미디어일 때 — 화면은 이 메시지를 그대로 토스트로 보여준다 */
export class GhostMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GhostMediaError';
  }
}

/**
 * 유령 미디어 방어 — 셋 중 하나라도 걸리면 draft(setMedia)에 들어가지 못한다.
 * 순서는 사용자에게 가장 이해하기 쉬운 순서(무엇을 다시 해야 하는지)로 뒀다.
 */
export function assertRealCapturedVideo(video: CapturedVideo): CapturedVideo {
  if (!video.uri || video.uri.trim().length === 0) {
    throw new GhostMediaError('촬영에 실패했습니다 — 다시 시도해주세요');
  }
  if (!/^video\//.test(video.mimeType)) {
    throw new GhostMediaError('영상 파일이 아닙니다 — 다시 선택해주세요');
  }
  if (!(video.sizeBytes > 0)) {
    throw new GhostMediaError('영상 정보를 확인할 수 없습니다 — 다시 시도해주세요');
  }
  return video;
}

/** URI 마지막 세그먼트를 파일명으로 (없으면 기본값) */
export function fileNameFromUri(uri: string): string {
  const last = uri.split('/').pop();
  return last && last.length > 0 ? last : 'video.mp4';
}

/* ─────────────────────────── ① 웹 촬영 (ImagePicker 주입) ─────────────────────────── */

/** expo-image-picker의 ImagePickerAsset 구조적 최소 부분집합 — 이 파일은 그 모듈을 import하지 않는다 */
export interface CameraLaunchAsset {
  readonly uri: string;
  readonly fileName?: string | null;
  readonly mimeType?: string;
  readonly fileSize?: number;
  readonly duration?: number | null;
}

export interface CameraLaunchResult {
  readonly canceled: boolean;
  readonly assets: readonly CameraLaunchAsset[] | null;
}

/** 주입 대상 — 실사용은 `import * as ImagePicker from 'expo-image-picker'`를 그대로 넘긴다 */
export interface CameraPicker {
  // expo-image-picker의 MediaType[]은 **mutable** 배열이다(ImagePickerOptions) — readonly 튜플로
  // 선언하면 실 ImagePicker 모듈 대입 시 구조적 타입체크가 깨진다(실측: tsc가 "readonly는 mutable
  // MediaType[]에 대입 불가"로 거부). pickFromLibrary도 같은 리터럴 `['videos']`를 쓴다(동형).
  launchCameraAsync(options: { mediaTypes: Array<'videos'> }): Promise<CameraLaunchResult>;
}

/**
 * 웹(과 네이티브 모두에서 호출 가능한) 촬영 진입점 — 실제로는 웹에서만 쓴다(index.tsx가
 * `Platform.OS === 'web'`일 때만 부른다. 네이티브는 기존 CameraView 임베디드 흐름을 유지한다 —
 * 이유는 이 화면의 "녹화 중 이탈 차단" UX를 건드리지 않기 위해서다).
 *
 * 취소(사용자가 파일 선택기를 닫음)는 null. expo-image-picker 문서 자체가 "모바일 웹에서는 취소
 * 이벤트가 브라우저 제약으로 못 올 수 있다"고 명시한다 — 그 경우 이 Promise는 해결되지 않는데,
 * 화면은 선택 중 아무것도 잠그지 않으므로(스피너 없음) 사용자는 버튼을 다시 누르면 된다
 * (구독자 dom-uploader.ts의 동일 함정·동일 완화와 동형).
 */
export async function captureVideoViaImagePicker(picker: CameraPicker): Promise<CapturedVideo | null> {
  const result = await picker.launchCameraAsync({ mediaTypes: ['videos'] });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;
  return assertRealCapturedVideo({
    uri: asset.uri,
    fileName: asset.fileName ?? fileNameFromUri(asset.uri),
    mimeType: asset.mimeType ?? 'video/mp4',
    sizeBytes: asset.fileSize ?? 0,
    ...(asset.duration != null ? { durationSec: Math.round(asset.duration / 1000) } : {}),
  });
}

/* ────────────────────── ② 네이티브 녹화 크기 실측 (FileSystem 주입) ────────────────────── */

export interface RecordedFileInfo {
  readonly exists: boolean;
  readonly size?: number;
}

/** 주입 대상 — 실사용은 `import * as FileSystem from 'expo-file-system/legacy'`를 그대로 넘긴다 */
export interface RecordedFileSystem {
  getInfoAsync(uri: string): Promise<RecordedFileInfo>;
}

/** 네이티브 recordAsync() 직후 실측 크기를 얻는다 — 읽기 실패·파일 없음은 0(방어가 다음 단계에서 잡는다) */
export async function resolveRecordedVideoSize(fs: RecordedFileSystem, uri: string): Promise<number> {
  try {
    const info = await fs.getInfoAsync(uri);
    return info.exists && typeof info.size === 'number' ? info.size : 0;
  } catch {
    return 0;
  }
}

/** 네이티브 recordAsync() 결과 { uri } → CapturedVideo(실측 크기 포함) + 유령 미디어 방어 */
export async function toCapturedRecordedVideo(
  fs: RecordedFileSystem,
  video: { uri: string },
): Promise<CapturedVideo> {
  const sizeBytes = await resolveRecordedVideoSize(fs, video.uri);
  return assertRealCapturedVideo({
    uri: video.uri,
    fileName: fileNameFromUri(video.uri),
    mimeType: 'video/mp4',
    sizeBytes,
  });
}
