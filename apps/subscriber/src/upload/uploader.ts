import { createUnsupportedUploader, type ResidentUploader } from './upload-contract';

/**
 * 업로더 해석 — **네이티브(iOS/Android) 기본 구현 = 미지원**.
 *
 * 이 파일이 `import { createResidentUploader } from './uploader'`의 기본 해석 대상이고, 웹 빌드에서만
 * Metro가 플랫폼 확장자 규칙으로 `uploader.web.ts`(DOM 구현)를 대신 고른다. 그래서 DOM 코드
 * (`document`·`XMLHttpRequest`)는 네이티브 번들에 **아예 포함되지 않는다** — `Platform.OS === 'web'`
 * 런타임 분기보다 강한 보장이며, `register-service-worker.ts`/`.web.ts` 선례와 동형이다.
 *
 * 계약·안내 문구는 `upload-contract.ts`가 원천이다(웹 변형이 이 파일을 import하면 자기 자신으로
 * 순환하므로 공유 조각을 제3의 파일에 둔다).
 */
export function createResidentUploader(): ResidentUploader {
  return createUnsupportedUploader();
}
