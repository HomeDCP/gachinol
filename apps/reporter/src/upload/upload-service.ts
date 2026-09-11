import type { ContentId } from '@gachinol/shared';
import { mockUploadService } from './mock-upload-service';

// UploadAbortedError는 mock 쪽 정의를 재수출 (mock→facade는 type-only import — 런타임 순환 방지)
export { UploadAbortedError } from './mock-upload-service';

export interface UploadProgress {
  loadedBytes: number;
  totalBytes: number;
  /** 0..1 */
  ratio: number;
}

export interface UploadInput {
  contentId: ContentId;
  fileUri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadResult {
  storageKey: string;
}

export interface UploadService {
  /**
   * 실 구현(HttpUploadService, 다음 단계) 계약:
   * ① POST 업로드 URL 발급 — shared IssueUploadUrlRequest → IssueUploadUrlResponse
   * ② presigned PUT 파일 전송(진행률 — 후보: expo-file-system 업로드 태스크 vs expo/fetch+Blob)
   * ③ 완료 통지 — shared CompleteUploadRequest
   * 상태 전이(draft→uploading→uploaded)는 서버 몫 — 클라이언트가 전이를 흉내내지 않는다.
   */
  upload(
    input: UploadInput,
    onProgress: (p: UploadProgress) => void,
    signal?: AbortSignal,
  ): Promise<UploadResult>;
}

/**
 * 유령 미디어 방어 — presigned PUT을 시도하기 **전** `UploadInput` 자체의 정합성을 검사한다
 * (대장 #173, 2026-09-11 조사자 실측).
 *
 * ★ 이 위치(업로드 서비스, 두 어댑터 공통 관문)에 두는 이유:
 * 조사 실측 — `expo-camera` 웹의 `record()`는 `{ uri: '' }`만 반환한다(throw 없음). 그 빈 uri가
 * `xhr-upload-service.ts`의 `env.resolveBody(fileUri)`(웹은 `fetch(uri)`)로 흘러가면, 브라우저가
 * **빈 문자열을 현재 SPA 페이지로 상대경로 해석**해 `res.ok=true`·HTML 셸 blob(size>0)을 돌려준다.
 * 그 blob이 기존 sizeBytes 폴백(`body.size > 0 ? body.size : input.sizeBytes`)과 서버 zod
 * (`sizeBytes.positive()`)까지 그대로 통과했다 — 즉 **빈 uri를 막는 방어가 전 구간에 0건**이었다.
 *
 * `src/capture/video-capture.ts`(촬영 직후)에도 동형 방어(`assertRealCapturedVideo`)를 두지만
 * **둘 다 둔다**: 저기는 "사용자가 즉시 알아볼 수 있는 실패"를 주는 자리(촬영 실패 안내)이고,
 * 여기는 두 어댑터(`xhr-upload-service.ts`·`http-upload-service.ts`)가 공유하는 업로드 직전
 * 공통 관문이다.
 *
 * ⚠️ **실제로 막는 것은 정확히 이 둘뿐이다**(2026-09-11 검증자가 함수를 직접 실행해 재현 —
 * 정상 blob URI 통과·빈 문자열 차단까지는 맞았지만, 비-blob 임의 문자열("/")과 위조 sizeBytes도
 * 예외 없이 통과함을 확인):
 *  ① `fileUri`가 빈 문자열이거나 공백만인 경우.
 *  ② `mimeType`이 `video/`로 시작하지 않는 경우.
 * **막지 않는 것**: `fileUri`의 **URI 스킴은 검사하지 않는다**(`blob:`/`file:` 여부 불문 —
 * `"/"` 같은 임의 문자열도 그대로 통과한다). `sizeBytes` 값 자체도 이 함수의 관심사가 아니다
 * (위조돼 있어도 통과) — 그건 **다른 층**이 한다: 웹 어댑터는 통과 후 **Blob 실측 크기**로
 * 재검사하고(`xhr-upload-service.ts`, `body.size<=0` 차단 — `input.sizeBytes`는 아예 안 봄),
 * 네이티브 어댑터는 `input.sizeBytes<=0`을 직접 재검사한다(`http-upload-service.ts`, 이 함수
 * 호출 직후).
 *
 * 그런데도 오늘 안전한 건 이 함수가 넓어서가 아니라 **호출부가 좁아서다**: 프로덕션에서 이
 * 함수를 부르는 곳은 위 두 어댑터 2곳뿐이고(`grep -rn "assertRealVideoInput(" apps/reporter/`로
 * 재확인 가능), 둘 다 캡처·갤러리 선택 위저드(`src/capture/video-capture.ts`·
 * `app/(app)/contents/new/index.tsx`)가 조립한 `UploadInput`만 받는다 — 지금 이 경로들이 만드는
 * fileUri는 전부 실제 `blob:`/파일 기반 URI다. ⚠️ **이 안전은 호출부 불변에 기댄다** — 새 진입
 * 경로가 생겨 비-file URI를 실어 나르면 이 가정은 깨진다(그때 비로소 URI 스킴 검증을 이
 * 함수에 추가하는 게 맞는 수정이다 — 지금은 아니다).
 */
export function assertRealVideoInput(input: UploadInput): void {
  if (!input.fileUri || input.fileUri.trim().length === 0) {
    throw new Error('영상 데이터가 없습니다 — 촬영이나 선택을 다시 진행해주세요');
  }
  if (!/^video\//.test(input.mimeType)) {
    throw new Error('영상 파일이 아닙니다 — 다시 선택해주세요');
  }
}

/**
 * 기본 export는 Mock(테스트·스토리북용). ★ 실사용 교체 지점은 useUploadService() 훅 —
 * 인증된 ApiClient(AuthProvider 컨텍스트) 주입이 필요해 모듈 싱글턴이 아니라 훅으로 제공한다.
 * 화면은 useUploadService()로 HttpUploadService를 얻는다.
 */
export const uploadService: UploadService = mockUploadService;
