import { Platform, type PlatformOSType } from 'react-native';
import type { ApiError, AuthTokens } from '@gachinol/shared';
import type { TokenStore } from '../auth/token-store';
import { ApiClientError, ApiNetworkError } from './errors';

/** access 만료 스큐 여유 — 이 시간 내 만료 예정이면 선제 refresh */
const ACCESS_EXPIRY_SKEW_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 웹 CSRF 커스텀 헤더 — `services/api/src/auth/auth.service.ts`의 `CSRF_HEADER`(`'x-requested-with'`)와
 * 이름이 정확히 같아야 `WebCsrfGuard`(`hasCsrfHeader`)를 통과한다. 값은 관용(존재 자체가 방어의 실체 —
 * 단순 요청으로는 붙일 수 없고, 붙이면 프리플라이트가 강제된다).
 */
const CSRF_HEADER = 'X-Requested-With';
const CSRF_HEADER_VALUE = 'gachinol-control-center';

/**
 * 네이티브 바디 경로 → 웹 쿠키 경로 매핑. 서버 계약(`auth.controller.ts`)의 `web/login`·`web/logout`은
 * 각각 `/auth/login`·`/auth/logout`과 요청 바디가 호환된다(로그인은 email/password 동일, 로그아웃은
 * 웹이 바디를 아예 요구하지 않으므로 무해하게 무시됨) — `api/auth.ts`(비소유 파일)를 건드리지 않고도
 * 이 표에서만 경로를 갈아끼운다. `/auth/refresh`는 여기 없다 — 웹은 `doRefresh()`가 `/auth/web/refresh`를
 * 직접 호출한다(쿠키 전용 계약이라 일반 `request()` 경로와 응답 형태가 다르다).
 */
const WEB_AUTH_PATH_MAP: Readonly<Record<string, string>> = {
  '/auth/login': '/auth/web/login',
  '/auth/logout': '/auth/web/logout',
};

/** `POST /v1/auth/web/login`·`/web/refresh` 응답 바디 — 서버 `WebSessionResponse`(auth.controller.ts)와 동형.
 * refresh 원문은 담기지 않는다(HttpOnly 쿠키 전용) — shared에 없는 웹 전용 서버 계약이라 로컬로 선언한다. */
interface WebSessionJson {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
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
  /** 테스트 DI — 기본 런타임 Platform.OS. token-store.ts와 동형 관례 */
  platformOS?: PlatformOSType;
}

export interface RequestOptions {
  /** JSON.stringify 대상 */
  body?: unknown;
  /** undefined 키 생략 */
  query?: Record<string, string | number | undefined>;
  /** 기본 true */
  auth?: boolean;
}

/**
 * refresh 시도 결과 3치 — `ensureFreshTokens()`/`doRefresh()` 반환.
 * 'ok'=유효한 access 확보 / 'signed-out'=세션 확정 종료(401·403, 재로그인 필요) /
 * 'error'=일시 장애(5xx·네트워크, 세션 판정 보류 — 토큰 보존, 재시도 가능).
 *
 * **게이트②(T-W2-04 재기동)**: 이전 boolean 반환은 실패 원인(401 vs 5xx)을 호출부
 * (`auth-context.tsx` bootstrap)가 `tokenStore.getRefreshToken()`으로 되짚어 재구성했다 — 이 값은
 * 웹에서 성공·401·5xx 무관하게 항상 `null`이라 그 재구성이 웹에서 통째로 무너진다(5xx도 signedOut으로
 * 오판정). 3치를 직접 반환해 호출부가 그 값을 그대로 소비하게 한다(재구성 불필요) — 네이티브·웹 양쪽
 * 다 플랫폼 무관 신호 하나로 판정.
 */
export type RefreshOutcome = 'ok' | 'signed-out' | 'error';

export interface ApiClient {
  request<TRes>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts?: RequestOptions,
  ): Promise<TRes>;
  /** AuthProvider 부트스트랩도 사용 */
  ensureFreshTokens(): Promise<RefreshOutcome>;
  /**
   * WS 핸드셰이크용 신선한 access 토큰 — 만료 임박(스큐 내)이면 선제 refresh 후 반환.
   * REST attempt()의 인증 로직과 동일 규칙. 토큰 없으면 null(익명 강등은 서버 게이트가 거절).
   */
  getFreshAccessToken(): Promise<string | null>;
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

  /** 네트워크·타임아웃 예외를 ApiNetworkError로 통일. 웹은 쿠키 세션이라 credentials:'include' 필수
   * (기본 fetch는 same-origin에도 쿠키를 담지만, api 오리진이 웹앱과 다른 서브도메인이라 명시 필요). */
  async function doFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchFn(url, {
        ...init,
        signal: controller.signal,
        ...(isWeb ? { credentials: 'include' as RequestCredentials } : {}),
      });
    } catch (cause) {
      throw new ApiNetworkError('서버에 연결할 수 없습니다', { cause });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * refresh 회전 실행.
   * ★ 네트워크 예외는 밖으로 전파 — 절대 clear() 하지 않는다 (오프라인 로그아웃 방지).
   * 실패 경로에서 구 refresh 재전송 재시도 금지(재사용 탐지 유발).
   *
   * **웹 분기(T-W2-04)**: `tokenStore.getRefreshToken()`은 웹에서 구조적으로 항상 `null`이다(refresh
   * 원문이 HttpOnly 쿠키에만 있고 JS가 못 읽는다) — 네이티브처럼 이 값으로 게이트하면 웹은 새로고침·
   * access 만료 후 **네트워크 호출 자체를 못 하고 즉시 실패**한다(복구 경로 없음, 발주-수신 대장 #71).
   * 웹은 그 값을 보지 않고 곧장 쿠키 전용 엔드포인트(`/auth/web/refresh`)를 호출한다 — 바디는 보내지
   * 않는다(서버가 쿠키만 보고 바디를 무시하는 계약, 보냈다간 공격자가 임의 토큰을 밀어 넣을 통로가 된다).
   */
  async function doRefresh(): Promise<RefreshOutcome> {
    if (isWeb) {
      const res = await doFetch(`${deps.baseUrl}/v1/auth/web/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json', [CSRF_HEADER]: CSRF_HEADER_VALUE },
      });
      if (res.ok) {
        const session = (await res.json()) as WebSessionJson;
        // refreshToken 필드는 token-store 웹 분기가 절대 사용/영속하지 않는다 — 타입만 채우는 빈 값
        await tokenStore.save({ ...session, refreshToken: '' });
        return 'ok';
      }
      if (res.status === 401 || res.status === 403) {
        await tokenStore.clear();
        deps.onSessionExpired();
        return 'signed-out';
      }
      // 5xx 등: 세션 판정 보류 — 토큰 보존(웹은 애초에 지역 토큰이 없으니 "보존"은 access 메모리 유지 의미)
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
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    // 웹: WebCsrfGuard가 걸린 경로(web/login·web/refresh·web/logout)만 요구하지만, 그 외 경로에
    // 얹혀도 서버는 무시한다(CORS allowedHeaders에도 포함) — 분기 없이 전 요청에 일괄 부착해 단순화.
    if (isWeb) headers[CSRF_HEADER] = CSRF_HEADER_VALUE;
    if (auth) {
      const access = tokenStore.getAccessToken();
      const expiresAt = tokenStore.getAccessTokenExpiresAt();
      const expiringSoon =
        !access || expiresAt === null || expiresAt - Date.now() < ACCESS_EXPIRY_SKEW_MS;
      // 웹은 getRefreshToken()이 항상 null(쿠키 전용)이라 이 값으로 게이트하지 않는다 — isWeb이면
      // 무조건 선제 refresh 시도(쿠키가 없으면 doRefresh가 401로 정직하게 실패할 뿐).
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

  /**
   * 웹 로그인 응답 변환 — 서버 `POST /auth/web/login`은 `{ user, accessToken, accessTokenExpiresAt,
   * refreshTokenExpiresAt }`(평평한 `WebLoginResponse`, refresh 원문 없음)를 돌려주지만, 이 앱의
   * `api/auth.ts`(비소유 파일) `login()`은 shared `LoginResponse`(`{ user, tokens: AuthTokens }`)
   * 형태를 기대한다. `api/auth.ts`를 고치는 대신 여기서 응답을 그 형태로 맞춰 끼운다 — refresh 필드는
   * token-store 웹 분기가 절대 읽지 않으므로 타입만 채우는 빈 문자열.
   */
  async function parseWebLoginResponse<TRes>(res: Response): Promise<TRes> {
    if (!res.ok) return parseResponse<TRes>(res); // 에러 파싱은 공통 경로 재사용(그대로 throw)
    const body = (await res.json()) as WebSessionJson & { user: unknown };
    const { user, accessToken, accessTokenExpiresAt, refreshTokenExpiresAt } = body;
    return {
      user,
      tokens: { accessToken, accessTokenExpiresAt, refreshTokenExpiresAt, refreshToken: '' },
    } as TRes;
  }

  async function request<TRes>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts: RequestOptions = {},
  ): Promise<TRes> {
    const auth = opts.auth ?? true;
    // 웹만 쿠키 경로로 갈아끼운다(login/logout) — api/auth.ts는 네이티브 바디 경로를 그대로 호출하고,
    // 여기서 조용히 치환한다(비소유 파일 무변경 원칙).
    const effectivePath = isWeb ? (WEB_AUTH_PATH_MAP[path] ?? path) : path;
    const url = `${deps.baseUrl}/v1${effectivePath}${buildQueryString(opts.query)}`;

    let res = await attempt(method, url, opts, auth);

    // 401 && auth && 최초 시도 && path가 /auth/ 미시작 → 정확히 1회 재시도 (원본 path 기준 — 치환 전과 동일 판정)
    if (res.status === 401 && auth && !path.startsWith('/auth/')) {
      const outcome = await ensureFreshTokens();
      if (outcome !== 'ok') {
        return parseResponse<TRes>(res); // unauthorized 그대로 throw
      }
      res = await attempt(method, url, opts, auth);
      // 재시도의 401은 그대로 실패 — 무한루프 금지
    }

    if (isWeb && path === '/auth/login') {
      return parseWebLoginResponse<TRes>(res);
    }
    return parseResponse<TRes>(res);
  }

  /** WS 핸드셰이크용 — attempt()의 선제 refresh 로직 재사용 */
  async function getFreshAccessToken(): Promise<string | null> {
    const access = tokenStore.getAccessToken();
    const expiresAt = tokenStore.getAccessTokenExpiresAt();
    const expiringSoon =
      !access || expiresAt === null || expiresAt - Date.now() < ACCESS_EXPIRY_SKEW_MS;
    if (expiringSoon && (isWeb || tokenStore.getRefreshToken())) {
      await ensureFreshTokens();
    }
    return tokenStore.getAccessToken();
  }

  return { request, ensureFreshTokens, getFreshAccessToken };
}
