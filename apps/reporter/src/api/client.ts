import type { ApiError, AuthTokens } from '@gachinol/shared';
import { Platform, type PlatformOSType } from 'react-native';
import type { TokenStore } from '../auth/token-store';
import { ApiClientError, ApiNetworkError } from './errors';

/** access 만료 스큐 여유 — 이 시간 내 만료 예정이면 선제 refresh */
const ACCESS_EXPIRY_SKEW_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * WebCsrfGuard(services/api/src/auth/auth.controller.ts)가 요구하는 커스텀 헤더 이름.
 * 서버는 존재 여부만 검사한다(값은 관용) — 관례값 'XMLHttpRequest'를 쓴다
 * (services/api/test/auth-web.e2e-spec.ts의 CSRF_VALUE와 동일 관례). 가드가 붙은 web/login·
 * web/refresh·web/logout 3종에만 부착한다(그 외 라우트는 가드가 없다 — 대장 #71 결함②·③ 해소).
 */
export const WEB_CSRF_HEADER = 'X-Requested-With';
export const WEB_CSRF_HEADER_VALUE = 'XMLHttpRequest';

/**
 * services/api `WebSessionResponse`(auth.controller.ts) 미러 — `packages/shared`에는 없다
 * (컨트롤러 로컬 export이고, 이 태스크의 파일 소유권상 shared는 건드릴 수 없다). refresh 원문은
 * 어떤 필드로도 담기지 않는다(HttpOnly 쿠키 전용, 02 §A D-T3).
 */
export interface WebSessionResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

/**
 * `WebSessionResponse`(+상속 타입인 `WebLoginResponse`) → `token-store.save()`가 받는 `AuthTokens`
 * 형태로 패딩. `refreshToken`은 빈 문자열 — 웹 분기의 `save()`(token-store.ts)는 이 필드를 절대
 * 읽지 않는다(HttpOnly 쿠키가 유일 원천). 두 앱(client.ts·auth-context.tsx)이 공유하는 변환이라
 * 여기 한 곳에 둔다(사본 금지).
 */
export function toWebAuthTokens(session: WebSessionResponse): AuthTokens {
  return {
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    refreshToken: '',
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
  };
}

export interface ApiClientDeps {
  /** getApiBaseUrl() — '/v1'은 클라이언트가 붙인다 */
  baseUrl: string;
  tokenStore: TokenStore;
  /** refresh 확정 실패(만료·폐기·재사용 탐지) 시 1회 호출 */
  onSessionExpired: () => void;
  /** 기본 globalThis.fetch */
  fetchFn?: typeof fetch;
  /** 기본 15000 (AbortController) */
  timeoutMs?: number;
  /** 테스트 DI용 — 기본값 런타임 Platform.OS (token-store.ts createTokenStore()와 동형 패턴) */
  platformOS?: PlatformOSType;
}

export interface RequestOptions {
  /** JSON.stringify 대상 */
  body?: unknown;
  /** undefined 키 생략 */
  query?: Record<string, string | number | undefined>;
  /** 기본 true */
  auth?: boolean;
  /** 추가 헤더 — 웹 CSRF 헤더(X-Requested-With) 부착 등. Accept/Content-Type과 병합(덮어쓰기 가능) */
  headers?: Record<string, string>;
}

/** ensureFreshTokens() 결과: 'ok'=유효한 access 확보 / 'signed-out'=세션 확정 종료(재로그인 필요) /
 * 'error'=일시 장애(네트워크·5xx, 세션 판정 보류 — 토큰 보존) */
export type RefreshOutcome = 'ok' | 'signed-out' | 'error';

export interface ApiClient {
  request<TRes>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts?: RequestOptions,
  ): Promise<TRes>;
  /** AuthProvider 부트스트랩도 사용 */
  ensureFreshTokens(): Promise<RefreshOutcome>;
}

function buildQueryString(query?: Record<string, string | number | undefined>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const fetchFn: typeof fetch = deps.fetchFn ?? ((...args) => globalThis.fetch(...args));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { tokenStore } = deps;
  const isWeb = (deps.platformOS ?? Platform.OS) === 'web';

  /**
   * 네트워크·타임아웃 예외를 ApiNetworkError로 통일.
   * 웹은 `credentials:'include'`를 항상 붙인다 — HttpOnly refresh 쿠키 왕복의 전제(대장 #71 결함②·③).
   * 일반(Bearer) 요청에도 붙지만 해가 없다: 쿠키가 없으면 그냥 아무 것도 안 실리고, 있어도 서버는
   * Bearer 라우트에서 쿠키를 읽지 않는다(웹 3종 라우트만 쿠키를 본다).
   */
  async function doFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const finalInit: RequestInit = isWeb ? { ...init, credentials: 'include' } : init;
      return await fetchFn(url, { ...finalInit, signal: controller.signal });
    } catch (cause) {
      throw new ApiNetworkError('서버에 연결할 수 없습니다', { cause });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * refresh 회전 실행 — 네이티브(바디+SecureStore)·웹(쿠키) 플랫폼 분기(병행, 02 §A D-T3).
   * ★ 네트워크 예외는 밖으로 전파 — 절대 clear() 하지 않는다 (오프라인 로그아웃 방지).
   * 실패 경로에서 구 refresh 재전송 재시도 금지(재사용 탐지 유발).
   */
  async function doRefresh(): Promise<RefreshOutcome> {
    if (isWeb) {
      // 웹은 로컬에 refresh 원문을 구조적으로 못 가진다(token-store.ts 웹 분기 — getRefreshToken()이
      // 항상 null). 대장 #71 결함②: 이 사실을 "세션 없음"으로 오판하면 안 된다 — 쿠키 세션이 살아
      // 있을 수 있으므로 **무조건** web/refresh를 1회 시도해 그 결과로만 판정한다.
      const res = await doFetch(`${deps.baseUrl}/v1/auth/web/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json', [WEB_CSRF_HEADER]: WEB_CSRF_HEADER_VALUE },
      });
      if (res.ok) {
        const session = (await res.json()) as WebSessionResponse;
        await tokenStore.save(toWebAuthTokens(session));
        return 'ok';
      }
      if (res.status === 401 || res.status === 403) {
        // 쿠키 부재·만료·재사용 탐지 — 세션 종료 확정(서버가 이미 쿠키를 지워 응답한다)
        await tokenStore.clear();
        deps.onSessionExpired();
        return 'signed-out';
      }
      // 5xx 등: 세션 판정 보류 — 토큰 보존
      return 'error';
    }

    const refreshToken = tokenStore.getRefreshToken();
    if (!refreshToken) return 'signed-out';
    // 재귀 방지: request()가 아니라 doFetch 직접 사용, Authorization 없음
    const res = await doFetch(`${deps.baseUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (res.ok) {
      // 회전된 새 쌍 전체 즉시 저장 (영속 완료 후 메모리 반영 — token-store 계약)
      await tokenStore.save((await res.json()) as AuthTokens);
      return 'ok';
    }
    if (res.status === 401 || res.status === 403) {
      // 만료·폐기·재사용 탐지 — 세션 종료 확정
      await tokenStore.clear();
      deps.onSessionExpired();
      return 'signed-out';
    }
    // 5xx 등: 세션 판정 보류 — 토큰 보존
    return 'error';
  }

  /**
   * single-flight: 동시 401 N건 → refresh 요청 정확히 1건.
   * 회전식이라 동시 2건이면 한쪽이 '재사용'으로 탐지돼 family 전체 폐기 — 직렬화는 정합성 요건.
   */
  let inflight: Promise<RefreshOutcome> | null = null;
  function ensureFreshTokens(): Promise<RefreshOutcome> {
    inflight ??= doRefresh().finally(() => {
      inflight = null;
    });
    return inflight; // 동시 호출 전부가 같은 Promise 공유
  }

  async function parseResponse<TRes>(res: Response): Promise<TRes> {
    if (res.ok) {
      if (res.status === 204) return undefined as TRes;
      // 런타임 재검증 없음 — 서버가 zod로 보장하는 shared 계약 신뢰
      return (await res.json()) as TRes;
    }
    let error: ApiError = { code: 'internal', message: '응답 파싱 실패' };
    try {
      const body = (await res.json()) as unknown;
      if (
        body !== null &&
        typeof body === 'object' &&
        typeof (body as ApiError).code === 'string' &&
        typeof (body as ApiError).message === 'string'
      ) {
        error = body as ApiError;
      }
    } catch {
      // 비JSON 에러 바디 — 합성 폴백 유지
    }
    throw new ApiClientError(res.status, error);
  }

  async function attempt(
    method: string,
    url: string,
    opts: RequestOptions,
    auth: boolean,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const access = tokenStore.getAccessToken();
      const expiresAt = tokenStore.getAccessTokenExpiresAt();
      const expiringSoon =
        !access || expiresAt === null || expiresAt - Date.now() < ACCESS_EXPIRY_SKEW_MS;
      // 웹은 로컬 refresh 판정이 불가능(getRefreshToken()이 항상 null)하므로 이 게이트를 그대로 쓰면
      // 선제 refresh가 영원히 스킵된다(대장 #71 결함②의 변주) — isWeb이면 로컬 판정 없이 시도한다.
      if (expiringSoon && (isWeb || tokenStore.getRefreshToken())) {
        await ensureFreshTokens(); // 선제 refresh (만료 30초 전 스큐 여유)
      }
      const token = tokenStore.getAccessToken();
      if (!token) {
        // access도 refresh도 없음(또는 refresh 확정 실패) — 즉시 unauthorized
        throw new ApiClientError(401, { code: 'unauthorized', message: '로그인이 필요합니다' });
      }
      headers.Authorization = `Bearer ${token}`;
    }
    return doFetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  }

  async function request<TRes>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts: RequestOptions = {},
  ): Promise<TRes> {
    const auth = opts.auth ?? true;
    const url = `${deps.baseUrl}/v1${path}${buildQueryString(opts.query)}`;

    let res = await attempt(method, url, opts, auth);

    // 401 && auth && 최초 시도 && path가 /auth/ 미시작 → 정확히 1회 재시도
    if (res.status === 401 && auth && !path.startsWith('/auth/')) {
      const outcome = await ensureFreshTokens();
      if (outcome !== 'ok') {
        return parseResponse<TRes>(res); // unauthorized 그대로 throw
      }
      res = await attempt(method, url, opts, auth);
      // 재시도의 401은 그대로 실패 — 무한루프 금지
    }

    return parseResponse<TRes>(res);
  }

  return { request, ensureFreshTokens };
}
