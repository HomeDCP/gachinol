import * as SecureStore from 'expo-secure-store';
import { Platform, type PlatformOSType } from 'react-native';
import type { AuthTokens } from '@gachinol/shared';

/**
 * 판정: SecureStore에는 refresh 토큰만 영속, access는 메모리 전용.
 * ① 회전 시 영속 시크릿이 1개 → torn-write(쌍 불일치 → 재사용 탐지 → family 전체 폐기) 구조적 제거
 * ② access(15분)는 콜드 스타트마다 refresh 1회로 재획득 — 탈취면 축소
 * ③ SecureStore 2KB 제한 회피
 *
 * **웹 분기(T-W2-01)**: `expo-secure-store`는 웹을 지원하지 않는다(`ExpoSecureStore.web.ts`가 빈 객체 `{}`를
 * export — 호출하면 크래시). 게다가 웹 세션은 애초에 설계가 다르다: `services/api` 웹 로그인 응답
 * (`WebSessionResponse`)은 refresh 토큰 **원문을 바디에 담지 않는다** — refresh는 HttpOnly 쿠키 전용으로
 * 서버가 `Set-Cookie`(웹 세션 쿠키)로만 내려주고, JS는 그 값을 읽을 수도 쓸 수도 없다
 * (`services/api/src/auth/auth.controller.ts`의 `WebSessionResponse` 주석·`test/auth-web.e2e-spec.ts` AC2 확정).
 * 따라서 웹 경로는 "SecureStore를 다른 저장소(localStorage 등)로 교체"가 아니라 **refresh 영속 계층 자체를
 * 제거**한다 — localStorage 같은 JS 접근 가능 저장소에 refresh를 대신 담으면 HttpOnly 쿠키로 옮긴 설계
 * 이유(XSS로부터 refresh 보호)가 무의미해진다. 웹에서 `load`/`save`/`clear`는 영속 저장소를 전혀 건드리지
 * 않는 no-op이며, `refreshToken` 메모리 변수도 절대 채우지 않는다(`getRefreshToken()`은 웹에서 항상
 * `null` — 정직한 값: 이 스토어는 웹에서 refresh 원문을 구조적으로 가질 수 없다). access는 네이티브와
 * 동일하게 메모리 전용으로 유지한다(플랫폼 무관 불변식).
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

/**
 * 토큰 값은 어떤 로그에도 출력 금지. shared `AuthTokens` 타입 그대로 — 재정의 금지.
 *
 * `platformOS`는 테스트 DI용(기본값 = 런타임 `Platform.OS`) — 다른 앱의 `createLiveSocket`/
 * `createControlSocket` DI 관례(소켓 팩토리 주입)와 동형: `jest.mock('react-native', ...)`으로
 * 전역 Platform을 흔들지 않고도 웹 분기를 단위 테스트할 수 있게 한다. 기존 `createTokenStore()`
 * 무인자 호출부(`auth-context.tsx`)는 기본값 경로라 무변경으로 계속 동작한다.
 */
export function createTokenStore(platformOS: PlatformOSType = Platform.OS): TokenStore {
  const isWeb = platformOS === 'web';
  let accessToken: string | null = null;
  let accessTokenExpiresAt: number | null = null;
  let refreshToken: string | null = null;

  return {
    async load(): Promise<void> {
      if (isWeb) return; // 웹: 영속 refresh가 없다(원문은 HttpOnly 쿠키에만 존재, 브라우저가 이미 보관 중) — 복원할 것이 없음
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
      if (isWeb) {
        // refresh 원문은 어떤 형태로도 보관하지 않는다 — HttpOnly 쿠키가 유일한 원천(JS 미접근).
        // access만 메모리에 반영(플랫폼 공통 불변식).
        accessToken = tokens.accessToken;
        const webAt = Date.parse(tokens.accessTokenExpiresAt);
        accessTokenExpiresAt = Number.isNaN(webAt) ? null : webAt;
        return;
      }
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
      if (isWeb) {
        // 영속 저장소를 쓴 적이 없으니 지울 것도 없다 — 메모리만 무효화
        accessToken = null;
        accessTokenExpiresAt = null;
        refreshToken = null;
        return;
      }
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
    // 웹에서는 save()가 refreshToken을 절대 채우지 않으므로 항상 null(원천적으로 값을 가질 수 없음 — 정직한 반환)
    getRefreshToken: () => refreshToken,
  };
}
