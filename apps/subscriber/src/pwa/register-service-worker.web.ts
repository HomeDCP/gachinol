import { Workbox } from 'workbox-window';
import { createServiceWorkerController, type ServiceWorkerController } from './sw-controller';
import { resolveBuildId, resolveServiceWorkerUrl } from './sw-update-policy';

/**
 * SW 등록 — **웹 전용 껍데기**(Metro 플랫폼 확장자로 웹 빌드에서만 선택된다. 네이티브 빌드는
 * `register-service-worker.ts`(no-op)를 쓰고 이 파일과 `workbox-window`는 번들에 포함되지 않는다).
 *
 * 판정은 전부 `sw-update-policy.ts`/`sw-controller.ts`에 있다 — 이 파일은 브라우저 API를 그 인터페이스에
 * 꽂기만 한다(로직 0). 그래서 이 파일에는 단위 테스트가 없고, 대신 테스트가 컨트롤러·리듀서를 직접 친다.
 *
 * `workbox-window` 채택 이유(02 §B 신규 의존성 표에 등재):
 *  - waiting 감지의 실제 난점(등록 시점에 **이미** waiting인 SW·다른 탭이 유발한 외부 갱신·`updatefound`
 *    중복 발화)을 정리해 준다. 직접 `registration.waiting`/`updatefound`를 다루면 이 경계 케이스에서
 *    토스트가 안 뜨거나 두 번 뜬다.
 *  - `messageSkipWaiting()`이 `public/sw.js`가 기다리는 `{type:'SKIP_WAITING'}`을 그대로 보낸다.
 *  - 반면 **Workbox 빌드 툴체인(`workbox-build`·`generateSW`/`injectManifest`)은 도입하지 않았다**:
 *    `infra/docker/Dockerfile.web`이 `expo export`를 직접 호출해 프리캐시 매니페스트를 주입할 후처리
 *    단계가 없고(그 파일은 이 태스크 소유 밖), CDN `importScripts`는 오프라인·CSP를 깬다. 그래서
 *    `public/sw.js`는 프리캐시 매니페스트가 필요 없는 **런타임 캐싱 전용**으로 직접 작성했다.
 */
export function registerServiceWorker(): ServiceWorkerController | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;

  const scriptSources = Array.from(document.querySelectorAll('script[src]')).map(
    (element) => element.getAttribute('src') ?? '',
  );
  const scriptUrl = resolveServiceWorkerUrl(resolveBuildId(scriptSources));
  // 해시 없는 빌드(= `expo start --web` 개발 서버)에서는 등록하지 않는다 — 근거는 sw-update-policy.ts
  if (!scriptUrl) return null;

  // updateViaCache:'none' — SW 스크립트 자체는 HTTP 캐시를 우회해 항상 재검증한다. 오리진 nginx가
  // `\.js$` 규칙으로 `/sw.js`에도 `immutable, max-age=1y`를 붙이고 있어(infra/docker/nginx.conf,
  // 이 태스크 소유 밖 — 완료 보고 ⑥) 브라우저 캐시 우회를 명시하지 않으면 갱신 검사 자체가 막힌다.
  const wb = new Workbox(scriptUrl, { updateViaCache: 'none' });

  const controller = createServiceWorkerController({
    onWaiting: (listener) => {
      wb.addEventListener('waiting', () => {
        listener(Boolean(navigator.serviceWorker.controller));
      });
    },
    onControllerChange: (listener) => {
      wb.addEventListener('controlling', () => listener());
    },
    register: () => {
      void wb.register().catch((error: unknown) => {
        // 등록 실패는 시청을 막지 않는다 — SW 없이도 앱은 정상 동작한다(점진적 향상).
        console.warn('[pwa] 서비스워커 등록 실패', error);
      });
    },
    skipWaiting: () => {
      void wb.messageSkipWaiting();
    },
    reload: () => {
      window.location.reload();
    },
  });

  return controller;
}
