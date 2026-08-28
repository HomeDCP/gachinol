import type { ApiClient } from '../api/client';
import type { UploadService } from './upload-service';
import { createXhrUploadService, type BlobLike, type XhrLike } from './xhr-upload-service';

/**
 * 실 업로드 구현 — **웹 해석**(Metro가 웹 빌드에서만 이 파일을 고른다. 구독자 `uploader.web.ts` 선례).
 *
 * 네이티브와 **같은 이름**을 export해 `use-upload-service.ts`의 DI 지점
 * (`import './http-upload-service'`)이 **무변경**으로 웹에서 이 어댑터를 얻는다 — 02 §E-7이 말한
 * "기존 useUploadService() DI 지점에 주입"이 훅 코드 수정 없이 모듈 해석 층에서 성립하고,
 * expo-file-system(네이티브 전용 — 웹에서 업로드 태스크가 동작하지 않아 T-W2-02 이전에는 기자 웹
 * 업로드가 기능 부재였다) 경로가 웹 번들에서 빠진다.
 *
 * 로직은 `xhr-upload-service.ts`에 있다(jest는 네이티브 해석이라 이 파일을 로드하지 않는다 —
 * 검증 가능 지점 분리). ⚠️ 여기서 `./http-upload-service`를 import하면 웹 해석에서 **이 파일
 * 자신**이라 순환이 된다 — 그래서 두 어댑터가 공유하는 `notifyUploadFailed`도 그쪽이 소유한다.
 */
export function createHttpUploadService(client: ApiClient): UploadService {
  if (typeof XMLHttpRequest === 'undefined' || typeof fetch === 'undefined') {
    // 전역이 없는 이례적인 웹 런타임(SSR 프리렌더 단계 등) — 정직한 실패로 떨어진다
    // (화면은 phase='failed'로 "다시 시도"를 보여준다. 조용한 무한 대기보다 낫다).
    return {
      upload: () =>
        Promise.reject(new Error('이 환경에서는 업로드를 지원하지 않습니다 — 새로고침 후 다시 시도해주세요')),
    };
  }
  return createXhrUploadService(client, {
    XhrCtor: XMLHttpRequest as unknown as new () => XhrLike,
    // 웹 픽커(expo-image-picker)의 uri는 blob:·data: — fetch로 Blob화해야 XHR 전송과
    // 실측 크기(zod positive 폴백) 확보가 된다. 읽기 실패는 ① 전이라 서버 무접촉.
    async resolveBody(uri: string): Promise<BlobLike> {
      const res = await fetch(uri);
      if (!res.ok) throw new Error('선택한 영상을 읽을 수 없습니다 — 다시 선택해주세요');
      return res.blob();
    },
  });
}
