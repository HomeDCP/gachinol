import { render, fireEvent, waitFor } from '@testing-library/react-native';

/**
 * 로그인 화면(app/(auth)/login.tsx) 렌더 테스트 — T-W2-26.
 *
 * control-center에는 렌더 커버리지가 있는 화면이 하나도 없었다(3앱 공통 결함, jest.config.js의
 * testMatch가 app/을 배제). 이 화면을 고른 이유:
 *  - 유일한 무인증 진입점이라 다른 화면과 달리 인증 컨텍스트 하나만 mock하면 렌더할 수 있다
 *    (react-query·expo-router 의존이 없다 — 이번 웨이브에서 가장 낮은 비용으로 렌더 테스트
 *    기반을 검증할 수 있는 화면).
 *  - 그럼에도 커버리지 0으로 남아있던 실제 위험 분기가 있다: "클라이언트측 검증 실패 시
 *    signIn을 아예 호출하지 않는다"는 것은 `validateLogin`(순수 함수, 이미 테스트됨)이
 *    아니라 **화면**의 `submit()` 안 `if (!result.ok) return;` 게이트가 보장한다. 이 게이트를
 *    지워도 순수 함수 테스트는 전혀 못 잡는다 — 이번 웨이브에서 반복된 결함 패턴과 동형.
 *
 * app/은 라우트 트리라 여기서 직접 import하지 않고 상대 경로로만 가져온다(E1 §C-2 —
 * expo-router의 require.context는 `+api`/`+html`/`+middleware` 외에는 아무 것도 제외하지
 * 않는다는 것을 소스로 확인했다: node_modules/expo-router/_ctx-shared.js).
 */
import LoginScreen from '../../../app/(auth)/login';

const mockSignIn = jest.fn();
jest.mock('../auth-context', () => ({
  useSession: () => ({
    session: { status: 'signedOut' },
    signIn: (...args: unknown[]) => mockSignIn(...args),
    signOut: jest.fn(),
    retryBootstrap: jest.fn(),
  }),
}));

beforeEach(() => {
  mockSignIn.mockReset();
});

describe('LoginScreen — 클라이언트측 검증이 signIn 호출을 막는다', () => {
  it('이메일·비밀번호가 비어 있으면 필드 에러만 뜨고 signIn은 호출되지 않는다', async () => {
    const { getByText } = await render(<LoginScreen />);

    await fireEvent.press(getByText('로그인'));

    await waitFor(() => expect(getByText('이메일을 입력해 주세요')).toBeTruthy());
    expect(getByText('비밀번호를 입력해 주세요')).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('이메일 형식이 잘못되면 signIn이 호출되지 않는다', async () => {
    const { getByPlaceholderText, getByText } = await render(<LoginScreen />);

    await fireEvent.changeText(getByPlaceholderText('operator@example.com'), 'not-an-email');
    await fireEvent.changeText(getByPlaceholderText('비밀번호'), 'password123');
    await fireEvent.press(getByText('로그인'));

    await waitFor(() => expect(getByText('올바른 이메일 형식이 아닙니다')).toBeTruthy());
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});

describe('LoginScreen — 검증 통과 시 signIn이 트리밍된 값으로 호출된다', () => {
  it('앞뒤 공백이 있는 이메일도 trim되어 signIn에 전달된다', async () => {
    mockSignIn.mockResolvedValue(undefined);
    const { getByPlaceholderText, getByText } = await render(<LoginScreen />);

    await fireEvent.changeText(getByPlaceholderText('operator@example.com'), '  operator@example.com  ');
    await fireEvent.changeText(getByPlaceholderText('비밀번호'), 'password123');
    await fireEvent.press(getByText('로그인'));

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith('operator@example.com', 'password123'),
    );
  });
});

describe('LoginScreen — signIn 실패가 화면에 노출된다', () => {
  it('signIn이 reject하면 폼 에러 메시지가 렌더된다', async () => {
    mockSignIn.mockRejectedValue(new Error('센터 계정으로만 로그인할 수 있습니다'));
    const { getByPlaceholderText, getByText } = await render(<LoginScreen />);

    await fireEvent.changeText(getByPlaceholderText('operator@example.com'), 'operator@example.com');
    await fireEvent.changeText(getByPlaceholderText('비밀번호'), 'password123');
    await fireEvent.press(getByText('로그인'));

    await waitFor(() =>
      expect(getByText('센터 계정으로만 로그인할 수 있습니다')).toBeTruthy(),
    );
  });
});
