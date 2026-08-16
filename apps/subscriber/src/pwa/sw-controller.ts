import {
  INITIAL_SW_UPDATE_STATE,
  reduceSwUpdate,
  type SwUpdateEvent,
  type SwUpdateState,
} from './sw-update-policy';

/**
 * 서비스워커 갱신 컨트롤러 — 리듀서(`sw-update-policy.ts`)와 브라우저 껍데기를 잇는 **DI 경계**.
 *
 * 브라우저 API를 직접 부르지 않고 주입된 `ServiceWorkerRuntime`만 호출하므로 jest에서 목 런타임으로
 * 전 경로를 검증할 수 있다(구독자 앱 `live-socket.ts`의 `socketFactory` DI와 동형 — 리포에 이미 있는 패턴).
 */

export interface ServiceWorkerRuntime {
  /** 신 SW가 waiting 상태가 되면 호출. 인자 = 현재 페이지를 제어 중인 SW 존재 여부 */
  onWaiting(listener: (hasController: boolean) => void): void;
  /** 제어자 교체(controllerchange / workbox `controlling`) 시 호출 */
  onControllerChange(listener: () => void): void;
  /** 등록 시작 — 컨트롤러 생성 시 1회 호출된다 */
  register(): void;
  /** 대기 중인 SW에 SKIP_WAITING 전달 */
  skipWaiting(): void;
  /** 페이지 재로드 */
  reload(): void;
}

export interface ServiceWorkerController {
  getState(): SwUpdateState;
  /** 상태 변화 구독 — 해제 함수 반환 */
  subscribe(listener: () => void): () => void;
  /** 사용자가 "새로고침"을 눌렀을 때만 호출한다(자동 호출 금지) */
  applyUpdate(): void;
  /** 구독 해제 — 이후 이벤트는 무시된다 */
  dispose(): void;
}

export function createServiceWorkerController(
  runtime: ServiceWorkerRuntime,
): ServiceWorkerController {
  let state: SwUpdateState = INITIAL_SW_UPDATE_STATE;
  let disposed = false;
  const listeners = new Set<() => void>();

  /** 유일한 상태 변경 경로 — 부수효과는 리듀서가 낸 목록 그대로만 실행한다(껍데기가 판단하지 않는다) */
  function dispatch(event: SwUpdateEvent): void {
    if (disposed) return;
    const { state: next, effects } = reduceSwUpdate(state, event);
    const changed = next !== state;
    state = next;
    for (const effect of effects) {
      if (effect === 'skip-waiting') runtime.skipWaiting();
      if (effect === 'reload') runtime.reload();
    }
    if (changed) for (const listener of listeners) listener();
  }

  runtime.onWaiting((hasController) => dispatch({ type: 'waiting', hasController }));
  runtime.onControllerChange(() => dispatch({ type: 'controller-changed' }));
  runtime.register();

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyUpdate: () => dispatch({ type: 'user-accepted' }),
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
