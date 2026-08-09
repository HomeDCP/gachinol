import type {
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  RefreshTokenRequest,
  RefreshTokenResponse,
  User,
} from '@gachinol/shared';
import type { ApiClient, WebSessionResponse } from './client';
import { WEB_CSRF_HEADER, WEB_CSRF_HEADER_VALUE } from './client';

/**
 * [웹] POST /v1/auth/web/login 응답 — services/api `WebLoginResponse`(auth.controller.ts) 미러.
 * `packages/shared`에는 없다(컨트롤러 로컬 export, shared는 이 태스크에서 건드릴 수 없다).
 * refresh 원문은 바디에 없다(HttpOnly 쿠키 전용) — `WebSessionResponse`가 그 계약을 이미 반영한다.
 */
export interface WebLoginResponse extends WebSessionResponse {
  user: User;
}

/** WebCsrfGuard가 요구하는 헤더 — 웹 인증 3종 호출에만 부착(대장 #71 결함③) */
const webCsrfHeaders = { [WEB_CSRF_HEADER]: WEB_CSRF_HEADER_VALUE };

/** POST /v1/auth/login (200) — @Public. 실패 3종 동일 메시지(계정 열거 방지). 네이티브 전용(바디 refresh) */
export const login = (c: ApiClient, body: LoginRequest): Promise<LoginResponse> =>
  c.request<LoginResponse>('POST', '/auth/login', { body, auth: false });

/**
 * [웹] POST /v1/auth/web/login (200) — @Public + WebCsrfGuard. refresh는 Set-Cookie(HttpOnly)로만
 * 내려간다 — 바디에는 access + user만 있다. `credentials:'include'`는 client.ts의 doFetch가 웹에서
 * 항상 부착한다(대장 #71 결함②·③).
 */
export const webLogin = (c: ApiClient, body: LoginRequest): Promise<WebLoginResponse> =>
  c.request<WebLoginResponse>('POST', '/auth/web/login', {
    body,
    auth: false,
    headers: webCsrfHeaders,
  });

/** POST /v1/auth/refresh (200) — @Public. 회전식 1회용 (통상은 client 인터셉터가 담당). 네이티브 전용 */
export const refreshTokens = (
  c: ApiClient,
  body: RefreshTokenRequest,
): Promise<RefreshTokenResponse> =>
  c.request<RefreshTokenResponse>('POST', '/auth/refresh', { body, auth: false });

/** POST /v1/auth/logout (204) — Bearer 필요 + 바디에 refresh. 해당 family만 폐기. 네이티브 전용 */
export const logout = (c: ApiClient, body: LogoutRequest): Promise<void> =>
  c.request<void>('POST', '/auth/logout', { body });

/**
 * [웹] POST /v1/auth/web/logout (204) — @Public + WebCsrfGuard. 쿠키에서 읽어 폐기(바디 없음, 멱등) —
 * 네이티브 logout()과 달리 refreshToken을 인자로 받지 않는다(애초에 JS가 원문을 가질 수 없다).
 */
export const webLogout = (c: ApiClient): Promise<void> =>
  c.request<void>('POST', '/auth/web/logout', { auth: false, headers: webCsrfHeaders });

/** GET /v1/auth/me — 세션 복원·role 게이트 근거 (플랫폼 공통, Bearer만 사용) */
export const getMe = (c: ApiClient): Promise<User> => c.request<User>('GET', '/auth/me');
