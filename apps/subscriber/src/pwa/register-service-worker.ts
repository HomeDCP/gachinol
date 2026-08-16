import type { ServiceWorkerController } from './sw-controller';

/**
 * SW 등록 — **네이티브(iOS/Android) 기본 구현 = no-op**.
 *
 * 이 파일이 `import ... from './register-service-worker'`의 기본 해석 대상이고, 웹 빌드에서만 Metro가
 * 플랫폼 확장자 규칙으로 `register-service-worker.web.ts`를 대신 고른다(리포의 `hls-video.tsx` /
 * `hls-video.web.tsx`와 동형). 서비스워커·`navigator`·`window`는 네이티브에 존재하지 않으므로
 * **웹 전용 코드가 네이티브 번들에 아예 포함되지 않는 것**이 `Platform.OS === 'web'` 런타임 분기보다
 * 강한 보장이다 — 런타임 분기는 `workbox-window`를 네이티브 번들에도 끌고 들어온다.
 *
 * null 반환 = "이 플랫폼에는 갱신 알림이 없다". 훅(`use-app-update.ts`)은 null이면 아무것도 구독하지
 * 않고 배너도 렌더하지 않는다(네이티브 무회귀).
 */
export function registerServiceWorker(): ServiceWorkerController | null {
  return null;
}
