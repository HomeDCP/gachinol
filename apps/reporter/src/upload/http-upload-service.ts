import * as FileSystem from 'expo-file-system/legacy';
import type {
  CompleteUploadRequest,
  Content,
  IssueUploadUrlRequest,
  IssueUploadUrlResponse,
} from '@gachinol/shared';
import type { ApiClient } from '../api/client';
import { UploadAbortedError } from './mock-upload-service';
import type { UploadInput, UploadProgress, UploadResult, UploadService } from './upload-service';
// ②·③ 실패/중단 후 서버측 복구 통지 — 정의·근거 주석은 xhr-upload-service.ts(T-W2-02에서 이동).
// 웹 어댑터와 같은 복구 의미론을 공유해야 하는데(사본 금지), 웹 해석에서 이 모듈 경로는
// http-upload-service.web.ts 자신이라 여기 두면 순환이 되어 그쪽이 소유한다.
import { notifyUploadFailed } from './xhr-upload-service';

/**
 * 실 업로드 구현 — presigned PUT 3단계. 상태 전이(draft→uploading→uploaded)는 서버 몫.
 * ① POST /contents/:id/upload-url (IssueUploadUrlRequest → IssueUploadUrlResponse)
 * ② presigned PUT 파일 전송 (진행률·취소는 expo-file-system 업로드 태스크)
 * ③ POST /contents/:id/upload-complete (CompleteUploadRequest → Content)
 *
 * presigned PUT은 URL에 서명이 포함돼 api 토큰이 불필요 — 파일 바이트는 api를 거치지 않고 S3로 직행.
 */
export function createHttpUploadService(client: ApiClient): UploadService {
  return {
    async upload(
      input: UploadInput,
      onProgress: (p: UploadProgress) => void,
      signal?: AbortSignal,
    ): Promise<UploadResult> {
      if (signal?.aborted) throw new UploadAbortedError();

      // ① 업로드 URL 발급 — draft|upload_failed → uploading (서버 전이. 클라 전이 흉내 금지)
      const issued = await client.request<IssueUploadUrlResponse>(
        'POST',
        `/contents/${input.contentId}/upload-url`,
        {
          body: {
            contentId: input.contentId,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
          } satisfies IssueUploadUrlRequest,
        },
      );

      // ①이 성공한 이 시점부터 서버는 uploading을 커밋했다 — 아래에서 던지는 에러는 전부
      // notifyUploadFailed로 서버에 통지(재발급 가능 상태로 복구)한 뒤 원래 에러를 그대로 재전파한다.
      try {
        // ② presigned PUT — 진행률·취소
        const task = FileSystem.createUploadTask(
          issued.uploadUrl,
          input.fileUri,
          {
            httpMethod: 'PUT',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: { 'Content-Type': input.mimeType },
          },
          (p) => {
            const total = p.totalBytesExpectedToSend || input.sizeBytes || 1;
            onProgress({
              loadedBytes: p.totalBytesSent,
              totalBytes: total,
              ratio: Math.min(p.totalBytesSent / total, 1),
            });
          },
        );

        const onAbort = (): void => {
          void task.cancelAsync();
        };
        signal?.addEventListener('abort', onAbort);
        try {
          const res = await task.uploadAsync();
          if (signal?.aborted || !res) throw new UploadAbortedError();
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`업로드 전송 실패 (HTTP ${res.status})`);
          }
        } finally {
          signal?.removeEventListener('abort', onAbort);
        }

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
