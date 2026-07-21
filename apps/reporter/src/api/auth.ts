import type {
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  RefreshTokenRequest,
  RefreshTokenResponse,
  User,
} from '@gachinol/shared';
import type { ApiClient } from './client';

/** POST /v1/auth/login (200) — @Public. 실패 3종 동일 메시지(계정 열거 방지) */
export const login = (c: ApiClient, body: LoginRequest): Promise<LoginResponse> =>
  c.request<LoginResponse>('POST', '/auth/login', { body, auth: false });

/** POST /v1/auth/refresh (200) — @Public. 회전식 1회용 (통상은 client 인터셉터가 담당) */
export const refreshTokens = (
  c: ApiClient,
  body: RefreshTokenRequest,
): Promise<RefreshTokenResponse> =>
  c.request<RefreshTokenResponse>('POST', '/auth/refresh', { body, auth: false });

/** POST /v1/auth/logout (204) — Bearer 필요 + 바디에 refresh. 해당 family만 폐기 */
export const logout = (c: ApiClient, body: LogoutRequest): Promise<void> =>
  c.request<void>('POST', '/auth/logout', { body });

/** GET /v1/auth/me — 세션 복원·role 게이트 근거 */
export const getMe = (c: ApiClient): Promise<User> => c.request<User>('GET', '/auth/me');
