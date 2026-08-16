import { render } from '@testing-library/react-native';
import { registerServiceWorker } from '../register-service-worker';

/**
 * 네이티브 무회귀 증명 — T-W1-04.
 *
 * 서비스워커는 웹 전용이다. jest-expo는 네이티브 플랫폼으로 모듈을 해석하므로, 이 스위트가 통과한다는
 * 것은 **네이티브 빌드에서 웹 구현(`register-service-worker.web.ts` · `workbox-window`)이 선택되지
 * 않는다**는 뜻이다. `Platform.OS === 'web'` 런타임 분기였다면 웹 코드가 네이티브 번들에 들어간 채로도
 * 이 테스트가 통과했겠지만, 플랫폼 확장자 분리라 모듈 해석 단계에서 갈린다.
 *
 * 다른 스위트와 달리 여기서는 `register-service-worker`를 **목으로 바꾸지 않는다** — 실물 해석 결과가
 * 검증 대상이기 때문이다.
 */

jest.mock('expo-router', () => {
  const react = jest.requireActual('react');
  const Stack = ({ children }: { children?: React.ReactNode }) =>
    react.createElement(react.Fragment, null, children);
  Stack.Screen = () => null;
  return { Stack };
});

import RootLayout from '../../../app/_layout';

describe('네이티브 경로', () => {
  it('registerServiceWorker()가 null을 돌려준다(= 네이티브 no-op 구현이 해석됐다)', () => {
    expect(registerServiceWorker()).toBeNull();
  });

  it('브라우저 전역을 만지지 않는다 — navigator/window가 없어도 그대로 동작한다', () => {
    const savedNavigator = globalThis.navigator;
    const savedWindow = (globalThis as { window?: unknown }).window;
    // @ts-expect-error — 네이티브 런타임에는 이 전역이 없다는 상황 재현
    delete globalThis.navigator;
    delete (globalThis as { window?: unknown }).window;

    try {
      expect(registerServiceWorker()).toBeNull();
    } finally {
      if (savedNavigator) globalThis.navigator = savedNavigator;
      if (savedWindow) (globalThis as { window?: unknown }).window = savedWindow;
    }
  });

  it('루트 레이아웃이 네이티브에서 갱신 배너 없이 렌더된다', async () => {
    const { queryByText } = await render(<RootLayout />);

    expect(queryByText('새 버전이 준비됐어요.')).toBeNull();
  });
});
