import * as FileSystem from 'expo-file-system/legacy';
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

/**
 * ②·③ 실패/중단 후 서버측 복구 통지 — ①(upload-url)이 이미 draft|upload_failed→uploading을
 * 커밋했으므로, 그 뒤 실패하면 콘텐츠가 `uploading`에 갇혀 재발급(upload-url, `ISSUABLE=
 * ['draft','upload_failed']`)이 409로 막힌다(재시도 교착). 전용 "실패 통지" 엔드포인트는 없으므로,
 * HEAD 검증 실패 시 내부적으로 uploading→upload_failed로 되돌리는 **기존** `upload-complete`
 * 엔드포인트(services/api UploadService.completeUpload)를 그대로 재사용해 통지한다(신규 서버
 * 엔드포인트 없이 클라이언트만으로 해결 — 서버·shared는 이 태스크 소유 밖).
 * 이 통지 호출 자체의 실패(기대된 400 등)는 삼킨다 — 목적은 응답이 아니라 서버측 부수효과이고,
 * 호출부에는 원래 에러를 그대로 전파해야 한다(이 함수가 원래 에러를 가리면 안 된다).
 */
async function notifyUploadFailed(
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
