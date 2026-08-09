import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { ReporterUser } from '@gachinol/shared';
import { isReporterUser } from '@gachinol/shared';
import { getMe, login, logout, webLogin, webLogout } from '../api/auth';
import { createApiClient, toWebAuthTokens } from '../api/client';
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

/** 아래 순수 함수 3종이 공유하는 의존성 — React 상태와 무관해 렌더 없이 단위 테스트 가능하다 */
export interface AuthDeps {
  client: ApiClient;
  tokenStore: TokenStore;
  /** true=웹(react-native-web). 기본은 컴포넌트가 Platform.OS로 계산해 넘긴다(테스트 DI용 파라미터) */
  isWeb: boolean;
}

/**
 * role-gate(로그인 계정이 기자가 아님) 판정 시 서버 세션도 함께 폐기한다.
 * 네이티브: 로컬 refreshToken(바디 경로) / 웹: 쿠키(웹 경로, `webLogout`) — 플랫폼별로 세션 원천이
 * 다르므로 정확히 조준해야 한다. 대장 #71 이전에는 웹에서 `tokenStore.getRefreshToken()`이 항상
 * null이라 이 폐기 자체가 통째로 스킵됐다(서버 쿠키 세션이 방치됨).
 */
export async function revokeSessionAndClear({ client, tokenStore, isWeb }: AuthDeps): Promise<void> {
  if (isWeb) {
    try {
      await webLogout(client);
    } catch {
      // best-effort — 실패해도 로컬 차단은 진행
    }
  } else {
    const refreshToken = tokenStore.getRefreshToken();
    if (refreshToken) {
      try {
        await logout(client, { refreshToken });
      } catch {
        // best-effort — 실패해도 로컬 차단은 진행
      }
    }
  }
  await tokenStore.clear();
}

/**
 * 부트스트랩 세션 판정 — 순수 로직(React 상태 무관, 렌더 없이 단위 테스트 가능).
 *
 * 네이티브: 로컬(SecureStore) refresh 부재 = 세션 부재를 단정할 수 있다 → 조기 signedOut(불필요한
 * 네트워크 호출 생략, 무회귀).
 * 웹(대장 #71 결함③ 해소): 로컬 저장소는 refresh 원문을 구조적으로 못 가진다(HttpOnly 쿠키 전용) —
 * `getRefreshToken()`이 항상 null이라도 쿠키 세션이 살아있을 수 있으므로 **web/refresh를 1회 시도**해
 * 그 결과로만 판정한다(`ensureFreshTokens()` → client.ts `doRefresh` 웹 분기가 실제 네트워크를 태운다).
 */
export async function bootstrapSession(deps: AuthDeps): Promise<Session> {
  const { client, tokenStore, isWeb } = deps;
  if (!isWeb && !tokenStore.getRefreshToken()) {
    return { status: 'signedOut' };
  }
  try {
    const outcome = await client.ensureFreshTokens();
    if (outcome === 'error') return { status: 'error' };
    if (outcome === 'signed-out') return { status: 'signedOut' };
    const me = await getMe(client);
    // role 게이트(입구): 센터 계정이 403 지뢰밭을 밟지 않게 차단
    if (!isReporterUser(me)) {
      // 서버 세션(refresh family/쿠키)도 폐기 — 방금 회전된 유효 세션을 방치하지 않는다.
      await revokeSessionAndClear(deps);
      showToast(REPORTER_ONLY_MESSAGE);
      return { status: 'signedOut' };
    }
    return { status: 'signedIn', user: me };
  } catch (err) {
    if (err instanceof ApiNetworkError || (isApiClientError(err) && err.status >= 500)) {
      // 네트워크 오류·서버 일시 장애(5xx)는 로그아웃 아님 — 토큰 보존 + 재시도 화면
      return { status: 'error' };
    }
    return { status: 'signedOut' };
  }
}

/**
 * 로그인 — 플랫폼별 엔드포인트로 분기(웹: `webLogin`/쿠키, 네이티브: `login`/바디+SecureStore).
 * role 게이트는 부트스트랩과 동일 정책(비기자 계정 → 서버 세션도 폐기 후 거부).
 */
export async function performSignIn(
  deps: AuthDeps,
  email: string,
  password: string,
): Promise<ReporterUser> {
  const { client, tokenStore, isWeb } = deps;
  if (isWeb) {
    const res = await webLogin(client, { email, password });
    await tokenStore.save(toWebAuthTokens(res)); // refreshToken 필드는 웹 분기의 save()가 무시(패딩)
    if (!isReporterUser(res.user)) {
      await revokeSessionAndClear(deps);
      throw new Error(REPORTER_ONLY_MESSAGE);
    }
    return res.user;
  }
  const res = await login(client, { email, password });
  await tokenStore.save(res.tokens);
  if (!isReporterUser(res.user)) {
    await revokeSessionAndClear(deps);
    throw new Error(REPORTER_ONLY_MESSAGE);
  }
  return res.user;
}

export function AuthProvider({ children }: PropsWithChildren): React.JSX.Element {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session>({ status: 'loading' });
  // Platform.OS는 앱 인스턴스 수명 동안 불변 — 1회 계산. 순수 함수(bootstrapSession 등) DI 인자.
  const isWebRef = useRef(Platform.OS === 'web');
  const isWeb = isWebRef.current;

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
    const result = await bootstrapSession({ client, tokenStore, isWeb });
    if (result.status === 'signedIn') {
      queryClient.setQueryData(authKeys.me, result.user);
    }
    setSession(result);
  }, [client, queryClient, tokenStore, isWeb]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      const user = await performSignIn({ client, tokenStore, isWeb }, email, password);
      queryClient.setQueryData(authKeys.me, user);
      setSession({ status: 'signedIn', user });
      router.replace('/');
    },
    [client, queryClient, tokenStore, isWeb],
  );

  /** 순서 고정: best-effort 서버 logout(플랫폼별 엔드포인트) → 토큰 폐기 → 캐시 클리어 → 로그인 화면 */
  const signOut = useCallback(async (): Promise<void> => {
    await revokeSessionAndClear({ client, tokenStore, isWeb });
    queryClient.clear();
    setSession({ status: 'signedOut' });
    router.replace('/login');
  }, [client, queryClient, tokenStore, isWeb]);

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
