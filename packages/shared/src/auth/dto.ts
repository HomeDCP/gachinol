import type { ISODateString } from '../common/time';
import type { User } from '../user/user';

/** POST /v1/auth/login 요청 */
export interface LoginRequest {
  email: string;
  /** 평문 비밀번호 — 전송 전용. 어떤 엔티티에도 저장 필드 없음 */
  password: string;
}

/** 로그인·refresh 공통 토큰 묶음. refresh는 회전식 — 1회 사용 후 폐기, 재사용 탐지 시 세션 계보(family) 전체 무효화 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: ISODateString;
  refreshTokenExpiresAt: ISODateString;
}

/** POST /v1/auth/login 응답 */
export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
}

/** POST /v1/auth/refresh 요청 */
export interface RefreshTokenRequest {
  refreshToken: string;
}

/** POST /v1/auth/refresh 응답 — 회전된 새 토큰 쌍 */
export type RefreshTokenResponse = AuthTokens;

/** POST /v1/auth/logout 요청 — 해당 세션(family)만 폐기 (다기기 지원) */
export interface LogoutRequest {
  refreshToken: string;
}
