import { useCallback, useEffect, useRef, useState } from 'react';
import { registerServiceWorker } from './register-service-worker';
import type { ServiceWorkerController } from './sw-controller';
import type { SwUpdateStatus } from './sw-update-policy';

export interface AppUpdate {
  /** 신 버전이 대기 중 — 배너를 띄운다(자동 적용·자동 재로드 금지) */
  readonly updateReady: boolean;
  /** 사용자가 적용을 눌렀고 제어권 교체를 기다리는 중 */
  readonly applying: boolean;
  /** 사용자 트리거 전용 — 이 함수 밖에서 skipWaiting이 호출되는 경로는 없다 */
  readonly applyUpdate: () => void;
}

/**
 * 앱 갱신 상태 훅. 루트 레이아웃에서 1회만 사용한다.
 *
 * 네이티브에서는 `registerServiceWorker()`가 null을 돌려주므로 구독도 렌더도 발생하지 않는다
 * (플랫폼 확장자로 웹 구현 자체가 네이티브 번들에 없다 — `register-service-worker.ts` 주석 참조).
 */
export function useAppUpdate(): AppUpdate {
  const controllerRef = useRef<ServiceWorkerController | null>(null);
  const [status, setStatus] = useState<SwUpdateStatus>('idle');

  useEffect(() => {
    const controller = registerServiceWorker();
    if (!controller) return undefined;
    controllerRef.current = controller;
    setStatus(controller.getState().status);
    const unsubscribe = controller.subscribe(() => setStatus(controller.getState().status));
    return () => {
      unsubscribe();
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const applyUpdate = useCallback(() => {
    controllerRef.current?.applyUpdate();
  }, []);

  return { updateReady: status === 'update-ready', applying: status === 'applying', applyUpdate };
}
