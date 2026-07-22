import type { ApiError, AuthTokens } from '@gachinol/shared';
import type { TokenStore } from '../auth/token-store';
import { ApiClientError, ApiNetworkError } from './errors';

/** access 만료 스큐 여유 — 이 시간 내 만료 예정이면 선제 refresh */
const ACCESS_EXPIRY_SKEW_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 15_000;

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
}

export interface RequestOptions {
  /** JSON.stringify 대상 */
  body?: unknown;
  /** undefined 키 생략 */
  query?: Record<string, string | number | undefined>;
  /** 기본 true */
  auth?: boolean;
}

export interface ApiClient {
  request<TRes>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts?: RequestOptions,
  ): Promise<TRes>;
  /** AuthProvider 부트스트랩도 사용 — true=유효한 access 확보 */
  ensureFreshTokens(): Promise<boolean>;
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

  /** 네트워크·타임아웃 예외를 ApiNetworkError로 통일 */
  async function doFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchFn(url, { ...init, signal: controller.signal });
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
   */
  async function doRefresh(): Promise<boolean> {
    const refreshToken = tokenStore.getRefreshToken();
    if (!refreshToken) return false;
    // 재귀 방지: request()가 아니라 doFetch 직접 사용, Authorization 없음
    const res = await doFetch(`${deps.baseUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (res.ok) {
      // 회전된 새 쌍 전체 즉시 저장 (영속 완료 후 메모리 반영 — token-store 계약)
      await tokenStore.save((await res.json()) as AuthTokens);
      return true;
    }
    if (res.status === 401 || res.status === 403) {
      // 만료·폐기·재사용 탐지 — 세션 종료 확정
      await tokenStore.clear();
      deps.onSessionExpired();
      return false;
    }
    // 5xx 등: 세션 판정 보류 — 토큰 보존
    return false;
  }

  /**
   * single-flight: 동시 401 N건 → refresh 요청 정확히 1건.
   * 회전식이라 동시 2건이면 한쪽이 '재사용'으로 탐지돼 family 전체 폐기 — 직렬화는 정합성 요건.
   */
  let inflight: Promise<boolean> | null = null;
  function ensureFreshTokens(): Promise<boolean> {
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
    if (auth) {
      const access = tokenStore.getAccessToken();
      const expiresAt = tokenStore.getAccessTokenExpiresAt();
      const expiringSoon =
        !access || expiresAt === null || expiresAt - Date.now() < ACCESS_EXPIRY_SKEW_MS;
      if (expiringSoon && tokenStore.getRefreshToken()) {
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
      const refreshed = await ensureFreshTokens();
      if (!refreshed) {
        return parseResponse<TRes>(res); // unauthorized 그대로 throw
      }
      res = await attempt(method, url, opts, auth);
      // 재시도의 401은 그대로 실패 — 무한루프 금지
    }

    return parseResponse<TRes>(res);
  }

  return { request, ensureFreshTokens };
}
