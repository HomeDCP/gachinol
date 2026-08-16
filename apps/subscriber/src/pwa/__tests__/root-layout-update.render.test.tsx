import { act, fireEvent, render } from '@testing-library/react-native';

/**
 * 루트 레이아웃(app/_layout.tsx) 갱신 배너 **렌더 테스트** — T-W1-04.
 *
 * 리듀서·컨트롤러 테스트가 통과해도 화면이 그 상태를 안 쓰면(배너 미배선·자동 reload 삽입) 아무 소용이
 * 없다 — T-W2-26이 닫은 "화면 계층 무보호" 유형. 여기서는 브라우저 API만 가짜로 두고 훅·컨트롤러·
 * 리듀서·배너·레이아웃 배선을 **전부 실물로** 통과시킨다.
 *
 * 테스트를 `src/**​/__tests__/`에 두는 이유: app/ 아래 두면 expo-router의 require.context가 라우트로
 * 흡수해 프로덕션 번들이 오염된다(리포 선례).
 */

const mockSw = {
  waiting: null as ((hasController: boolean) => void) | null,
  controllerChanged: null as (() => void) | null,
  register: jest.fn(),
  skipWaiting: jest.fn(),
  reload: jest.fn(),
};

// 실 컨트롤러를 그대로 쓰고 **런타임(브라우저 API)만** 가짜로 주입한다.
jest.mock('../register-service-worker', () => {
  const { createServiceWorkerController } = jest.requireActual('../sw-controller');
  return {
    registerServiceWorker: () =>
      createServiceWorkerController({
        onWaiting: (listener: (hasController: boolean) => void) => {
          mockSw.waiting = listener;
        },
        onControllerChange: (listener: () => void) => {
          mockSw.controllerChanged = listener;
        },
        register: () => mockSw.register(),
        skipWaiting: () => mockSw.skipWaiting(),
        reload: () => mockSw.reload(),
      }),
  };
});

jest.mock('expo-router', () => {
  const react = jest.requireActual('react');
  const Stack = ({ children }: { children?: React.ReactNode }) =>
    react.createElement(react.Fragment, null, children);
  Stack.Screen = () => null;
  return { Stack };
});

import RootLayout from '../../../app/_layout';

const NOTICE = '새 버전이 준비됐어요.';

async function renderLayout() {
  const view = await render(<RootLayout />);
  return view;
}

describe('루트 레이아웃 — 새 버전 알림 배너', () => {
  beforeEach(() => {
    mockSw.waiting = null;
    mockSw.controllerChanged = null;
  });

  it('마운트하면 서비스워커 등록을 시작한다', async () => {
    await renderLayout();

    expect(mockSw.register).toHaveBeenCalledTimes(1);
  });

  it('대기 중인 신 버전이 없으면 배너가 렌더되지 않는다', async () => {
    const { queryByText } = await renderLayout();

    expect(queryByText(NOTICE)).toBeNull();
  });

  it('신 버전이 감지되면 배너가 뜬다 — 그러나 아무것도 적용하지 않는다', async () => {
    const { getByText } = await renderLayout();

    await act(async () => {
      mockSw.waiting?.(true);
    });

    expect(getByText(NOTICE)).toBeTruthy();
    expect(getByText('새로고침')).toBeTruthy();
    // 감지만으로 적용·재로드가 일어나면 시청 중인 화면이 갈아엎힌다
    expect(mockSw.skipWaiting).not.toHaveBeenCalled();
    expect(mockSw.reload).not.toHaveBeenCalled();
  });

  it('첫 설치(제어자 없음)에는 배너를 띄우지 않는다', async () => {
    const { queryByText } = await renderLayout();

    await act(async () => {
      mockSw.waiting?.(false);
    });

    expect(queryByText(NOTICE)).toBeNull();
  });

  it('사용자가 "새로고침"을 눌러야 적용이 시작된다', async () => {
    const { getByText } = await renderLayout();
    await act(async () => {
      mockSw.waiting?.(true);
    });

    await act(async () => {
      fireEvent.press(getByText('새로고침'));
    });

    expect(mockSw.skipWaiting).toHaveBeenCalledTimes(1);
    expect(getByText('적용하는 중…')).toBeTruthy();
    // 제어권이 아직 안 넘어왔으므로 재로드는 아직이다
    expect(mockSw.reload).not.toHaveBeenCalled();
  });

  it('사용자가 누르지 않은 채 제어자가 바뀌어도 재로드하지 않는다(자동 강제새로고침 금지)', async () => {
    await renderLayout();

    await act(async () => {
      mockSw.waiting?.(true);
      mockSw.controllerChanged?.();
    });

    expect(mockSw.reload).not.toHaveBeenCalled();
  });

  it('누른 뒤 제어자가 바뀌면 그때 재로드한다', async () => {
    const { getByText } = await renderLayout();
    await act(async () => {
      mockSw.waiting?.(true);
    });
    await act(async () => {
      fireEvent.press(getByText('새로고침'));
    });

    await act(async () => {
      mockSw.controllerChanged?.();
    });

    expect(mockSw.reload).toHaveBeenCalledTimes(1);
  });
});
