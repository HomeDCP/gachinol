import { createDomResidentUploader, type DocumentLike, type XhrLike } from './dom-uploader';
import { createUnsupportedUploader, type ResidentUploader } from './upload-contract';

/**
 * 업로더 해석 — **웹 구현**(Metro가 웹 빌드에서만 이 파일을 고른다).
 *
 * 로직 자체는 `dom-uploader.ts`가 갖고 여기서는 진짜 DOM 전역을 주입만 한다 — 그래야 jest(네이티브
 * 해석)에서도 어댑터 동작을 검증할 수 있다. 전역이 없는 이례적인 웹 런타임(SSR 프리렌더 단계 등)에
 * 대비해 존재 확인 후 미지원 구현으로 떨어진다(그 경우 화면은 정직한 안내를 보여준다).
 *
 * `./uploader`를 import하지 않는 이유: 웹 해석에서 `./uploader`는 **이 파일 자신**이라 순환이 된다.
 * 공유 계약은 `upload-contract.ts`에 있다.
 */
export function createResidentUploader(): ResidentUploader {
  if (typeof document === 'undefined' || typeof XMLHttpRequest === 'undefined') {
    return createUnsupportedUploader();
  }
  return createDomResidentUploader({
    doc: document as unknown as DocumentLike,
    XhrCtor: XMLHttpRequest as unknown as new () => XhrLike,
  });
}
