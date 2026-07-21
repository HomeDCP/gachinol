// TODO(upload-api): services/api에 업로드 URL 발급·완료 엔드포인트 도입 시 HttpUploadService로 교체.
// shared 계약(IssueUploadUrlRequest 등) 선정의됨. 이 Mock은 서버 상태를 절대 바꾸지 않는다
// (콘텐츠는 draft 유지 — draft→uploading 전이는 미래 업로드 API의 몫).
import type { UploadInput, UploadProgress, UploadResult, UploadService } from './upload-service';

/** 업로드 취소 (AbortSignal) */
export class UploadAbortedError extends Error {
  constructor() {
    super('업로드가 취소되었습니다');
    this.name = 'UploadAbortedError';
  }
}

const TICK_MS = 250;
const TOTAL_TICKS = 12; // ~3초

/** 타이머 기반 진행률 시뮬레이션 — 서버 호출 없음 */
export const mockUploadService: UploadService = {
  upload(
    input: UploadInput,
    onProgress: (p: UploadProgress) => void,
    signal?: AbortSignal,
  ): Promise<UploadResult> {
    return new Promise<UploadResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new UploadAbortedError());
        return;
      }
      const totalBytes = input.sizeBytes > 0 ? input.sizeBytes : 1;
      let tick = 0;

      const onAbort = (): void => {
        cleanup();
        reject(new UploadAbortedError());
      };
      const timer = setInterval(() => {
        tick += 1;
        const ratio = Math.min(tick / TOTAL_TICKS, 1);
        onProgress({ loadedBytes: Math.round(totalBytes * ratio), totalBytes, ratio });
        if (tick >= TOTAL_TICKS) {
          cleanup();
          resolve({ storageKey: `mock/contents/${input.contentId}/original` });
        }
      }, TICK_MS);
      const cleanup = (): void => {
        clearInterval(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      signal?.addEventListener('abort', onAbort);
    });
  },
};
