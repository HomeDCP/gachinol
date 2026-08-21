/**
 * feedback 모듈 계약 테스트.
 *
 * 이번 결함의 본질은 "웹에서 확인 콜백이 영원히 실행되지 않는다"는 것이었다 —
 * react-native-web의 Alert가 빈 함수라 Promise가 어느 쪽으로도 결정되지 않았다.
 * 그래서 여기서 고정하는 불변식은 **confirmDialog가 반드시 결정된다(settle)**는 것이다.
 * 렌더 트리(FeedbackHost)는 테스트 라이브러리 의존성을 늘리지 않기 위해 범위 밖으로 둔다.
 */
import { Alert, ToastAndroid } from 'react-native';

type AlertButton = { text?: string; style?: string; onPress?: () => void };

/**
 * Platform.OS를 바꿔 모듈을 새로 로드 — `isWeb`이 모듈 로드 시점에 고정되기 때문.
 * 스프레드(`{...actual}`) 대신 Proxy를 쓰는 이유: 스프레드는 react-native의 모든 lazy getter를
 * 즉시 평가해 네이티브 모듈(DevMenu 등)을 요구하고 jest 환경에서 터진다. Proxy는 실제로 참조된
 * 심볼만 평가한다.
 */
function loadFeedbackAs(os: 'ios' | 'android' | 'web'): typeof import('../feedback') {
  let mod!: typeof import('../feedback');
  jest.isolateModules(() => {
    jest.doMock('react-native', () => {
      const actual = jest.requireActual('react-native');
      return new Proxy(actual, {
        get: (target, prop) =>
          prop === 'Platform'
            ? { ...(target as { Platform: object }).Platform, OS: os }
            : (target as Record<string | symbol, unknown>)[prop],
      });
    });
    mod = require('../feedback');
  });
  return mod;
}

describe('confirmDialog — 네이티브(Alert 위임)', () => {
  it('확인 버튼을 누르면 true로 결정된다', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      (buttons as AlertButton[])?.find((b) => b.text === '승인')?.onPress?.();
    });
    const { confirmDialog } = loadFeedbackAs('ios');
    await expect(confirmDialog({ title: '승인할까요?', confirmText: '승인' })).resolves.toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('취소 버튼을 누르면 false로 결정된다', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      (buttons as AlertButton[])?.find((b) => b.style === 'cancel')?.onPress?.();
    });
    const { confirmDialog } = loadFeedbackAs('ios');
    await expect(confirmDialog({ title: '승인할까요?' })).resolves.toBe(false);
  });

  it('destructive면 확인 버튼 style이 destructive다', async () => {
    let captured: AlertButton[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      captured = (buttons ?? []) as AlertButton[];
      captured.find((b) => b.style === 'cancel')?.onPress?.();
    });
    const { confirmDialog } = loadFeedbackAs('ios');
    await confirmDialog({ title: '나갈까요?', confirmText: '나가기', destructive: true });
    expect(captured.find((b) => b.text === '나가기')?.style).toBe('destructive');
  });
});

describe('confirmDialog — 웹', () => {
  it('호스트가 없으면 취소(false)로 결정된다 — 영원히 대기하지 않는다', async () => {
    const { confirmDialog } = loadFeedbackAs('web');
    // 이 단언이 깨지면 결함이 재발한 것이다(Promise 미결정 = 버튼 무반응)
    await expect(confirmDialog({ title: '승인할까요?' })).resolves.toBe(false);
  });

  it('웹에서는 Alert.alert를 호출하지 않는다 (no-op이라 무의미)', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { confirmDialog } = loadFeedbackAs('web');
    await confirmDialog({ title: '승인할까요?' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('showToast', () => {
  it('android는 네이티브 토스트를 쓴다', () => {
    const spy = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
    const { showToast } = loadFeedbackAs('android');
    showToast('저장했습니다');
    expect(spy).toHaveBeenCalledWith('저장했습니다', ToastAndroid.SHORT);
  });

  it('ios는 Alert 폴백을 쓴다', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { showToast } = loadFeedbackAs('ios');
    showToast('저장했습니다');
    expect(spy).toHaveBeenCalledWith('저장했습니다');
  });

  it('웹은 호스트가 없어도 던지지 않는다 — 토스트 때문에 흐름이 끊기면 안 된다', () => {
    const { showToast } = loadFeedbackAs('web');
    expect(() => showToast('저장했습니다')).not.toThrow();
  });
});
