import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { getMe, login, logout } from '../api/auth';
import { createApiClient } from '../api/client';
import type { ApiClient } from '../api/client';
import { ApiNetworkError, isApiClientError } from '../api/errors';
import { getApiBaseUrl } from '../config/env';
import { authKeys } from '../query/keys';
import { showToast } from '../ui/toast';
import { CENTER_ONLY_MESSAGE, isCenterConsoleUser } from './role';
import type { CenterConsoleUser } from './role';
import { createTokenStore } from './token-store';
import type { TokenStore } from './token-store';

/** 웹은 refresh 원문을 절대 가질 수 없다(HttpOnly 쿠키 전용) — `token-store.ts` 웹 분기와 동일 판정 */
const isWeb = Platform.OS === 'web';

/**
 * best-effort 서버 로그아웃 — 4곳(bootstrap 역할게이트·signIn 역할게이트·signOut)에서 재사용.
 * **웹(T-W2-04)**: `tokenStore.getRefreshToken()`은 웹에서 항상 `null`이라 `if (refreshToken)` 게이트를
 * 그대로 두면 웹에서는 서버 로그아웃이 **한 번도 호출되지 않는다** — 로컬은 signedOut이어도 서버 쿠키
 * 세션(refresh family)이 14일간 그대로 살아남는다. 웹은 무조건 호출한다(`POST /auth/web/logout`은
 * 쿠키만 보고 바디를 요구하지 않는 멱등 엔드포인트라 안전 — client.ts가 경로를 갈아끼운다).
 * 네이티브는 기존과 동일하게 refreshToken이 있을 때만(없으면 애초에 지울 세션이 없다).
 */
async function bestEffortLogout(client: ApiClient, refreshToken: string | null): Promise<void> {
  if (!isWeb && !refreshToken) return;
  try {
    await logout(client, { refreshToken: refreshToken ?? '' });
  } catch {
    // best-effort — 실패해도 로컬 차단/종료는 진행
  }
}

/** 세션 상태 — 'error'는 부트스트랩 네트워크 실패(오프라인에서 세션을 태우지 않는다 → 재시도 화면) */
export type Session =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: CenterConsoleUser };

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
    // 웹은 getRefreshToken()이 구조적으로 항상 null(원문이 HttpOnly 쿠키에만 있다) — 이 값으로
    // 조기 종료하면 유효한 쿠키 세션이 있어도 무조건 signedOut으로 판정해버린다(발주-수신 대장 #71).
    // 네이티브만 이 값으로 게이트하고, 웹은 아래 ensureFreshTokens()(→ /auth/web/refresh, 쿠키 전용)로
    // 세션 존재 여부를 직접 확인한다.
    if (!isWeb && !tokenStore.getRefreshToken()) {
      setSession({ status: 'signedOut' });
      return;
    }
    try {
      // 게이트②(T-W2-04 재기동): 이전에는 여기서 tokenStore.getRefreshToken()으로 실패 원인(401 vs 5xx)을
      // 되짚었다 — 웹은 그 값이 성공·401·5xx 무관하게 항상 null이라 재구성이 무너져 5xx도 signedOut으로
      // 오판정했다(재시도 화면이 아니라 로그인 화면으로 강제 이동). ensureFreshTokens()가 이제 원인을
      // 직접 반환하므로(RefreshOutcome) 그 값을 그대로 소비한다 — 재구성 불필요, 네이티브·웹 공통 판정.
      const outcome = await client.ensureFreshTokens();
      if (outcome === 'error') {
        // 5xx·일시 장애 — 토큰 보존, 재시도 화면
        setSession({ status: 'error' });
        return;
      }
      if (outcome === 'signed-out') {
        // 401/403 — 세션 확정 종료(client가 이미 clear 완료)
        setSession({ status: 'signedOut' });
        return;
      }
      const me = await getMe(client);
      // role 게이트(입구): 센터 계정이 아니면 403 지뢰밭을 밟지 않게 차단
      if (!isCenterConsoleUser(me)) {
        // 서버 세션(refresh family)도 폐기 — 방금 회전된 유효 family를 방치하지 않는다.
        // 순서 고정: logout(Bearer 필요)이 먼저, clear는 그 다음 (signOut과 동일 정책)
        await bestEffortLogout(client, tokenStore.getRefreshToken());
        await tokenStore.clear();
        showToast(CENTER_ONLY_MESSAGE);
        setSession({ status: 'signedOut' });
        return;
      }
      queryClient.setQueryData(authKeys.me, me);
      setSession({ status: 'signedIn', user: me });
    } catch (err) {
      if (err instanceof ApiNetworkError || (isApiClientError(err) && err.status >= 500)) {
        // 네트워크 오류·서버 일시 장애(5xx)는 로그아웃 아님 — 토큰 보존 + 재시도 화면
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
      if (!isCenterConsoleUser(res.user)) {
        // 방금 발급된 서버 세션(refresh family)도 폐기 — 로컬만 지우면 14일간 유효하게 잔존한다.
        // save 후라 access가 있어 logout(Bearer 필요) 호출 가능 — best-effort
        // 웹은 res.tokens.refreshToken이 client.ts 변환에서 채운 빈 문자열이므로 tokenStore가 아니라
        // bestEffortLogout의 isWeb 무조건 호출 분기에 맡긴다(빈 문자열은 falsy라 그대로 두면 스킵됨).
        await bestEffortLogout(client, res.tokens.refreshToken || null);
        await tokenStore.clear();
        throw new Error(CENTER_ONLY_MESSAGE);
      }
      queryClient.setQueryData(authKeys.me, res.user);
      setSession({ status: 'signedIn', user: res.user });
      router.replace('/');
    },
    [client, queryClient, tokenStore],
  );

  /** 순서 고정: best-effort 서버 logout → 토큰 폐기 → 캐시 클리어 → 로그인 화면 */
  const signOut = useCallback(async (): Promise<void> => {
    await bestEffortLogout(client, tokenStore.getRefreshToken());
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

/** 로그인된 센터 운영자·관리자 — (app) 그룹 내부 전용 (가드 뒤에서만 호출) */
export function useCenterUser(): CenterConsoleUser {
  const { session } = useSession();
  if (session.status !== 'signedIn') {
    throw new Error('useCenterUser는 로그인된 상태에서만 사용할 수 있습니다');
  }
  return session.user;
}
