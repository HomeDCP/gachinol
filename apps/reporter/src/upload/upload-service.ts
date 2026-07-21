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

/** ★ 교체 지점 단일화 — 업로드 API 도입 시 이 한 줄만 HttpUploadService로 바꾼다 */
export const uploadService: UploadService = mockUploadService;
