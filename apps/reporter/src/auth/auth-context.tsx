import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { ReporterUser } from '@gachinol/shared';
import { isReporterUser } from '@gachinol/shared';
import { getMe, login, logout } from '../api/auth';
import { createApiClient } from '../api/client';
import type { ApiClient } from '../api/client';
import { ApiNetworkError, isApiClientError } from '../api/errors';
import { getApiBaseUrl } from '../config/env';
import { authKeys } from '../query/keys';
import { showToast } from '../ui/toast';
import { createTokenStore } from './token-store';
import type { TokenStore } from './token-store';

export const REPORTER_ONLY_MESSAGE = '기자 전용 앱입니다. 기자 계정으로 로그인해 주세요.';

/** 세션 상태 — 'error'는 부트스트랩 네트워크 실패(오프라인에서 세션을 태우지 않는다 → 재시도 화면) */
export type Session =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: ReporterUser };

interface AuthContextValue {
  session: Session;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  retryBootstrap(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ApiClientContext = createContext<ApiClient | null>(null);

export function AuthProvider({ children }: PropsWithChildren): React.JSX.Element {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session>({ status: 'loading' });

  // onSessionExpired가 최신 핸들러를 보도록 ref 경유 (client는 1회 생성)
  const sessionExpiredRef = useRef<() => void>(() => {});
  const tokenStoreRef = useRef<TokenStore | null>(null);
  tokenStoreRef.current ??= createTokenStore();
  const tokenStore = tokenStoreRef.current;
  const clientRef = useRef<ApiClient | null>(null);
  clientRef.current ??= createApiClient({
    baseUrl: getApiBaseUrl(),
    tokenStore,
    onSessionExpired: () => sessionExpiredRef.current(),
  });
  const client = clientRef.current;

  // refresh 확정 실패(만료·폐기·재사용 탐지) — 토큰은 client가 이미 clear
  sessionExpiredRef.current = () => {
    queryClient.clear();
    setSession((prev) => {
      if (prev.status === 'signedIn') {
        showToast('세션이 만료되었습니다. 다시 로그인해 주세요.');
      }
      return { status: 'signedOut' };
    });
  };

  const bootstrap = useCallback(async (): Promise<void> => {
    setSession({ status: 'loading' });
    await tokenStore.load();
    if (!tokenStore.getRefreshToken()) {
      setSession({ status: 'signedOut' });
      return;
    }
    try {
      const ok = await client.ensureFreshTokens();
      if (!ok) {
        // 401/403이면 clear 완료(refresh 부재) → signedOut / 5xx면 토큰 보존 → 재시도 화면
        setSession(tokenStore.getRefreshToken() ? { status: 'error' } : { status: 'signedOut' });
        return;
      }
      const me = await getMe(client);
      // role 게이트(입구): 센터 계정이 403 지뢰밭을 밟지 않게 차단
      if (!isReporterUser(me)) {
        // 서버 세션(refresh family)도 폐기 — 방금 회전된 유효 family를 방치하지 않는다.
        // 순서 고정: logout(Bearer 필요)이 먼저, clear는 그 다음 (signOut과 동일 정책)
        const refreshToken = tokenStore.getRefreshToken();
        if (refreshToken) {
          try {
            await logout(client, { refreshToken });
          } catch {
            // best-effort — 실패해도 로컬 차단은 진행
          }
        }
        await tokenStore.clear();
        showToast(REPORTER_ONLY_MESSAGE);
        setSession({ status: 'signedOut' });
        return;
      }
      queryClient.setQueryData(authKeys.me, me);
      setSession({ status: 'signedIn', user: me });
    } catch (err) {
      if (err instanceof ApiNetworkError || (isApiClientError(err) && err.status >= 500)) {
        // 네트워크 오류·서버 일시 장애(5xx)는 로그아웃 아님 — 토큰 보존 + 재시도 화면
        // (refresh 5xx 경로·README 인증 규약과 동일: 일시 장애는 세션을 태우지 않는다)
        setSession({ status: 'error' });
        return;
      }
      setSession({ status: 'signedOut' });
    }
  }, [client, queryClient, tokenStore]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      const res = await login(client, { email, password });
      await tokenStore.save(res.tokens);
      if (!isReporterUser(res.user)) {
        // 방금 발급된 서버 세션(refresh family)도 폐기 — 로컬만 지우면 14일간 유효하게 잔존한다.
        // save 후라 access가 있어 logout(Bearer 필요) 호출 가능 — best-effort
        try {
          await logout(client, { refreshToken: res.tokens.refreshToken });
        } catch {
          // best-effort — 실패해도 로컬 차단은 진행
        }
        await tokenStore.clear();
        throw new Error(REPORTER_ONLY_MESSAGE);
      }
      queryClient.setQueryData(authKeys.me, res.user);
      setSession({ status: 'signedIn', user: res.user });
      router.replace('/');
    },
    [client, queryClient, tokenStore],
  );

  /** 순서 고정: best-effort 서버 logout → 토큰 폐기 → 캐시 클리어 → 로그인 화면 */
  const signOut = useCallback(async (): Promise<void> => {
    const refreshToken = tokenStore.getRefreshToken();
    if (refreshToken) {
      try {
        await logout(client, { refreshToken });
      } catch {
        // best-effort — 실패 무시 (로컬 세션은 무조건 종료)
      }
    }
    await tokenStore.clear();
    queryClient.clear();
    setSession({ status: 'signedOut' });
    router.replace('/login');
  }, [client, queryClient, tokenStore]);

  const retryBootstrap = useCallback(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <ApiClientContext.Provider value={client}>
      <AuthContext.Provider value={{ session, signIn, signOut, retryBootstrap }}>
        {children}
      </AuthContext.Provider>
    </ApiClientContext.Provider>
  );
}

export function useSession(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useSession은 AuthProvider 안에서만 사용할 수 있습니다');
  return ctx;
}

export function useApiClient(): ApiClient {
  const ctx = useContext(ApiClientContext);
  if (!ctx) throw new Error('useApiClient는 AuthProvider 안에서만 사용할 수 있습니다');
  return ctx;
}

/** 로그인된 기자 — (app) 그룹 내부 전용 (가드 뒤에서만 호출) */
export function useReporter(): ReporterUser {
  const { session } = useSession();
  if (session.status !== 'signedIn') {
    throw new Error('useReporter는 로그인된 상태에서만 사용할 수 있습니다');
  }
  return session.user;
}
