import * as SecureStore from 'expo-secure-store';
import type { AuthTokens } from '@gachinol/shared';

/**
 * 판정: SecureStore에는 refresh 토큰만 영속, access는 메모리 전용.
 * ① 회전 시 영속 시크릿이 1개 → torn-write(쌍 불일치 → 재사용 탐지 → family 전체 폐기) 구조적 제거
 * ② access(15분)는 콜드 스타트마다 refresh 1회로 재획득 — 탈취면 축소
 * ③ SecureStore 2KB 제한 회피
 */
const REFRESH_KEY = 'gachinol.auth.refresh'; // 값: JSON { token, expiresAt }
const SS_OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } as const;

interface PersistedRefresh {
  token: string;
  expiresAt: string;
}

export interface TokenStore {
  /** 앱 시작 1회 — SecureStore → 메모리 */
  load(): Promise<void>;
  /** ★ SecureStore(refresh) 영속 완료 후 메모리 access 갱신 */
  save(tokens: AuthTokens): Promise<void>;
  /** SecureStore 삭제 + 메모리 무효화 (실패해도 메모리는 무조건 비움) */
  clear(): Promise<void>;
  getAccessToken(): string | null;
  /** epoch ms — 선제 refresh 판단 */
  getAccessTokenExpiresAt(): number | null;
  getRefreshToken(): string | null;
}

/** 토큰 값은 어떤 로그에도 출력 금지. shared `AuthTokens` 타입 그대로 — 재정의 금지. */
export function createTokenStore(): TokenStore {
  let accessToken: string | null = null;
  let accessTokenExpiresAt: number | null = null;
  let refreshToken: string | null = null;

  return {
    async load(): Promise<void> {
      try {
        const raw = await SecureStore.getItemAsync(REFRESH_KEY, SS_OPTS);
        if (!raw) return;
        const parsed = JSON.parse(raw) as PersistedRefresh;
        if (typeof parsed?.token === 'string') refreshToken = parsed.token;
      } catch {
        // 손상 데이터는 무시 — 재로그인 유도
        refreshToken = null;
      }
    },

    async save(tokens: AuthTokens): Promise<void> {
      // ★ 영속(refresh) 완료 후에만 메모리 갱신 — 실패 시 구 상태 유지
      const persisted: PersistedRefresh = {
        token: tokens.refreshToken,
        expiresAt: tokens.refreshTokenExpiresAt,
      };
      await SecureStore.setItemAsync(REFRESH_KEY, JSON.stringify(persisted), SS_OPTS);
      refreshToken = tokens.refreshToken;
      accessToken = tokens.accessToken;
      const at = Date.parse(tokens.accessTokenExpiresAt);
      accessTokenExpiresAt = Number.isNaN(at) ? null : at;
    },

    async clear(): Promise<void> {
      try {
        await SecureStore.deleteItemAsync(REFRESH_KEY, SS_OPTS);
      } finally {
        accessToken = null;
        accessTokenExpiresAt = null;
        refreshToken = null;
      }
    },

    getAccessToken: () => accessToken,
    getAccessTokenExpiresAt: () => accessTokenExpiresAt,
    getRefreshToken: () => refreshToken,
  };
}
