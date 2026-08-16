import { createServiceWorkerController, type ServiceWorkerRuntime } from '../sw-controller';

/**
 * 컨트롤러(DI 경계) 테스트 — T-W1-04.
 *
 * 리듀서가 낸 부수효과가 **실제로 런타임 호출로 이어지는지**를 고정한다. 리듀서 테스트만으로는
 * "판정은 맞는데 껍데기가 그 판정을 안 쓰는" 배선 결함을 못 잡는다(Wave 8a에서 반복된 유형).
 */

interface Harness {
  runtime: ServiceWorkerRuntime;
  emitWaiting: (hasController: boolean) => void;
  emitControllerChange: () => void;
  skipWaiting: jest.Mock;
  reload: jest.Mock;
  register: jest.Mock;
}

function createHarness(): Harness {
  let waitingListener: ((hasController: boolean) => void) | null = null;
  let controllerListener: (() => void) | null = null;
  const skipWaiting = jest.fn();
  const reload = jest.fn();
  const register = jest.fn();

  return {
    runtime: {
      onWaiting: (listener) => {
        waitingListener = listener;
      },
      onControllerChange: (listener) => {
        controllerListener = listener;
      },
      register,
      skipWaiting,
      reload,
    },
    emitWaiting: (hasController) => waitingListener?.(hasController),
    emitControllerChange: () => controllerListener?.(),
    skipWaiting,
    reload,
    register,
  };
}

describe('createServiceWorkerController', () => {
  it('생성 즉시 등록을 시작한다', () => {
    const h = createHarness();
    createServiceWorkerController(h.runtime);

    expect(h.register).toHaveBeenCalledTimes(1);
  });

  it('신 버전 감지 → 구독자에게 알리고 상태만 바꾼다(적용·재로드 없음)', () => {
    const h = createHarness();
    const controller = createServiceWorkerController(h.runtime);
    const onChange = jest.fn();
    controller.subscribe(onChange);

    h.emitWaiting(true);

    expect(controller.getState().status).toBe('update-ready');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(h.skipWaiting).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('사용자가 applyUpdate()를 불러야 skipWaiting이 나간다', () => {
    const h = createHarness();
    const controller = createServiceWorkerController(h.runtime);
    h.emitWaiting(true);

    controller.applyUpdate();

    expect(h.skipWaiting).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toEqual({ status: 'applying', userAccepted: true });
    // 아직 재로드하지 않는다 — 제어권이 실제로 넘어간 뒤다
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('사용자 확인 없는 제어자 교체는 재로드하지 않는다(시청 중 이탈 금지)', () => {
    const h = createHarness();
    createServiceWorkerController(h.runtime);

    h.emitWaiting(false); // 첫 설치 — clients.claim()이 제어권을 잡는다
    h.emitControllerChange();

    expect(h.reload).not.toHaveBeenCalled();
  });

  it('감지 → 사용자 확인 → 제어자 교체 순서로만 재로드한다', () => {
    const h = createHarness();
    const controller = createServiceWorkerController(h.runtime);

    h.emitWaiting(true);
    h.emitControllerChange(); // 아직 안 눌렀다
    expect(h.reload).not.toHaveBeenCalled();

    controller.applyUpdate();
    h.emitControllerChange();

    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('dispose 후에는 이벤트를 무시한다', () => {
    const h = createHarness();
    const controller = createServiceWorkerController(h.runtime);
    controller.dispose();

    h.emitWaiting(true);

    expect(controller.getState().status).toBe('idle');
  });

  it('구독 해제 함수가 실제로 통지를 끊는다', () => {
    const h = createHarness();
    const controller = createServiceWorkerController(h.runtime);
    const onChange = jest.fn();
    const unsubscribe = controller.subscribe(onChange);
    unsubscribe();

    h.emitWaiting(true);

    expect(onChange).not.toHaveBeenCalled();
  });
});
