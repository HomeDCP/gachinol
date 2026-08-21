import { toId } from '@gachinol/shared';
import type { CenterStaffUser, ReporterUser, StationId, UserId } from '@gachinol/shared';
import type { ApiClient, RefreshOutcome } from '../../api/client';
import type { TokenStore } from '../token-store';

// auth-context.tsx는 모듈 스코프에서 `expo-router`를 import한다(AuthProvider 컴포넌트의
// signIn/signOut이 router.replace를 쓴다). 여기서 검증하는 순수 함수(bootstrapSession 등)는
// router를 전혀 건드리지 않지만, 실 expo-router는 @react-navigation/native를 트랜지티브로 끌어오고
// 그 패키지의 pnpm(.pnpm/@scope+pkg@ver) 플래튼 경로가 jest.config.js의 transformIgnorePatterns
// 화이트리스트와 어긋나 raw ESM 파싱 실패를 낸다(reporter 전역 설정 파일은 이 태스크의 소유 파일이
// 아니라 건드리지 않는다) — 모듈 자체를 얕게 모의해 그 체인을 아예 안 태운다.
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../../ui/toast', () => ({ showToast: jest.fn() }));

import {
  REPORTER_ONLY_MESSAGE,
  bootstrapSession,
  performSignIn,
  revokeSessionAndClear,
} from '../auth-context';

const { showToast } = jest.requireMock('../../ui/toast') as { showToast: jest.Mock };

const reporter: ReporterUser = {
  id: toId<UserId>('u1'),
  name: '기자1',
  role: 'reporter',
  stationId: toId<StationId>('s1'),
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const centerStaff: CenterStaffUser = {
  id: toId<UserId>('u2'),
  name: '센터운영자',
  role: 'center_operator',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** 요청 경로별 응답을 라우팅하는 최소 ApiClient 페이크. client.ts 자체는 client.test.ts가 검증한다 —
 * 여기서는 auth-context.tsx의 플랫폼 분기·role 게이트 판정 로직만 본다. */
function fakeApiClient(
  handlers: Record<string, (opts?: unknown) => unknown>,
  ensureFreshTokensResult: RefreshOutcome | (() => Promise<RefreshOutcome>) = 'ok',
): { client: ApiClient; request: jest.Mock; ensureFreshTokens: jest.Mock } {
  const request = jest.fn(async (method: string, path: string, opts?: unknown) => {
    const key = `${method} ${path}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`핸들러 없음: ${key}`);
    return handler(opts);
  });
  const ensureFreshTokens = jest.fn(
    typeof ensureFreshTokensResult === 'function'
      ? ensureFreshTokensResult
      : async () => ensureFreshTokensResult,
  );
  return {
    client: { request, ensureFreshTokens } as unknown as ApiClient,
    request,
    ensureFreshTokens,
  };
}

function fakeTokenStore(init: { refresh?: string | null } = {}) {
  let refresh = init.refresh ?? null;
  let access: string | null = null;
  const clearMock = jest.fn();
  const saveMock = jest.fn();
  const store: TokenStore = {
    async load() {},
    async save(tokens) {
      saveMock(tokens);
      access = tokens.accessToken;
    },
    async clear() {
      clearMock();
      refresh = null;
      access = null;
    },
    getAccessToken: () => access,
    getAccessTokenExpiresAt: () => null,
    getRefreshToken: () => refresh,
  };
  return { store, clearMock, saveMock };
}

beforeEach(() => {
  showToast.mockClear();
});

describe('bootstrapSession — 네이티브(무회귀)', () => {
  test('로컬 refresh 없으면 즉시 signedOut, ensureFreshTokens 미호출(불필요한 네트워크 생략)', async () => {
    const { store } = fakeTokenStore({ refresh: null });
    const { client, ensureFreshTokens } = fakeApiClient({});

    const result = await bootstrapSession({ client, tokenStore: store, isWeb: false });

    expect(result).toEqual({ status: 'signedOut' });
    expect(ensureFreshTokens).not.toHaveBeenCalled();
  });

  test('로컬 refresh 있고 회전 성공 + 기자 계정 → signedIn', async () => {
    const { store } = fakeTokenStore({ refresh: 'ref1' });
    const { client } = fakeApiClient({ 'GET /auth/me': () => reporter }, 'ok');

    const result = await bootstrapSession({ client, tokenStore: store, isWeb: false });

    expect(result).toEqual({ status: 'signedIn', user: reporter });
  });

  test("ensureFreshTokens가 'error' → status:'error'(재시도 화면, 세션 유지)", async () => {
    const { store } = fakeTokenStore({ refresh: 'ref1' });
    const { client } = fakeApiClient({}, 'error');

    const result = await bootstrapSession({ client, tokenStore: store, isWeb: false });

    expect(result).toEqual({ status: 'error' });
  });

  test('role 게이트: 기자 아님 → 서버 logout(refreshToken) + clear + signedOut + 안내 토스트', async () => {
    const { store, clearMock } = fakeTokenStore({ refresh: 'ref1' });
    const { client, request } = fakeApiClient({ 'GET /auth/me': () => centerStaff }, 'ok');

    const result = await bootstrapSession({ client, tokenStore: store, isWeb: false });

    expect(result).toEqual({ status: 'signedOut' });
    expect(request).toHaveBeenCalledWith('POST', '/auth/logout', { body: { refreshToken: 'ref1' } });
    expect(clearMock).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(REPORTER_ONLY_MESSAGE);
  });
});

describe('bootstrapSession — 웹 (대장 #71 결함③ 해소)', () => {
  test('로컬 refresh가 항상 null이어도(웹 정직값) web/refresh 성공이면 signedIn — 네트워크가 실제로 시도된다', async () => {
    const { store } = fakeTokenStore({ refresh: null }); // 웹의 정직한 값
    const { client, ensureFreshTokens } = fakeApiClient({ 'GET /auth/me': () => reporter }, 'ok');

    const result = await bootstrapSession({ client, tokenStore: store, isWeb: true });

    expect(ensureFreshTokens).toHaveBeenCalledTimes(1); // 결함② 재현 시엔 0회였다
    expect(result).toEqual({ status: 'signedIn', user: reporter });
  });

  test("web/refresh가 'signed-out'(쿠키 부재·만료) → signedOut, getMe 미호출", async () => {
    const { store } = fakeTokenStore({ refresh: null });
    const { client, request } = fakeApiClient({}, 'signed-out');

    const result = await bootstrapSession({ client, tokenStore: store, isWeb: true });

    expect(result).toEqual({ status: 'signedOut' });
    expect(request).not.toHaveBeenCalled();
  });

  test("web/refresh가 'error'(5xx·네트워크) → status:'error'(재시도 화면)", async () => {
    const { store } = fakeTokenStore({ refresh: null });
    const { client } = fakeApiClient({}, 'error');

    const result = await bootstrapSession({ client, tokenStore: store, isWeb: true });

    expect(result).toEqual({ status: 'error' });
  });

  test('role 게이트: 기자 아님 → webLogout(쿠키) + clear + signedOut (로컬 refresh가 없어 네이티브 logout은 스킵되던 자리)', async () => {
    const { store, clearMock } = fakeTokenStore({ refresh: null });
    const { client, request } = fakeApiClient({ 'GET /auth/me': () => centerStaff }, 'ok');

    const result = await bootstrapSession({ client, tokenStore: store, isWeb: true });

    expect(result).toEqual({ status: 'signedOut' });
    expect(request).toHaveBeenCalledWith('POST', '/auth/web/logout', {
      auth: false,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(clearMock).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(REPORTER_ONLY_MESSAGE);
  });
});

describe('performSignIn', () => {
  test('네이티브 무회귀: login 호출 + tokens 그대로 save + 기자 유저 반환', async () => {
    const { store, saveMock } = fakeTokenStore();
    const tokens = {
      accessToken: 'acc1',
      refreshToken: 'ref1',
      accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
      refreshTokenExpiresAt: '2026-01-15T00:00:00.000Z',
    };
    const { client } = fakeApiClient({
      'POST /auth/login': () => ({ user: reporter, tokens }),
    });

    const user = await performSignIn({ client, tokenStore: store, isWeb: false }, 'a@b.com', 'pw');

    expect(user).toEqual(reporter);
    expect(saveMock).toHaveBeenCalledWith(tokens);
  });

  test('웹: webLogin 호출 + refresh를 빈 문자열로 패딩해 save + 기자 유저 반환', async () => {
    const { store, saveMock } = fakeTokenStore();
    const { client, request } = fakeApiClient({
      'POST /auth/web/login': () => ({
        user: reporter,
        accessToken: 'acc-w1',
        accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
        refreshTokenExpiresAt: '2026-01-15T00:00:00.000Z',
      }),
    });

    const user = await performSignIn({ client, tokenStore: store, isWeb: true }, 'a@b.com', 'pw');

    expect(user).toEqual(reporter);
    expect(request).toHaveBeenCalledWith('POST', '/auth/web/login', {
      body: { email: 'a@b.com', password: 'pw' },
      auth: false,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(saveMock).toHaveBeenCalledWith({
      accessToken: 'acc-w1',
      accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
      refreshToken: '',
      refreshTokenExpiresAt: '2026-01-15T00:00:00.000Z',
    });
  });

  test('웹: 기자 아님 → webLogout으로 세션 폐기 후 REPORTER_ONLY_MESSAGE throw', async () => {
    const { store, clearMock } = fakeTokenStore();
    const { client, request } = fakeApiClient({
      'POST /auth/web/login': () => ({
        user: centerStaff,
        accessToken: 'acc-w1',
        accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
        refreshTokenExpiresAt: '2026-01-15T00:00:00.000Z',
      }),
    });

    await expect(
      performSignIn({ client, tokenStore: store, isWeb: true }, 'a@b.com', 'pw'),
    ).rejects.toThrow(REPORTER_ONLY_MESSAGE);

    expect(request).toHaveBeenCalledWith('POST', '/auth/web/logout', {
      auth: false,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(clearMock).toHaveBeenCalledTimes(1);
  });
});

describe('revokeSessionAndClear', () => {
  test('웹: 로컬 refresh가 없어도(항상 null) webLogout을 호출한다(대장 #71 이전엔 통째로 스킵됐다)', async () => {
    const { store, clearMock } = fakeTokenStore({ refresh: null });
    const { client, request } = fakeApiClient({ 'POST /auth/web/logout': () => undefined });

    await revokeSessionAndClear({ client, tokenStore: store, isWeb: true });

    expect(request).toHaveBeenCalledWith('POST', '/auth/web/logout', {
      auth: false,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(clearMock).toHaveBeenCalledTimes(1);
  });

  test('네이티브: refresh 있으면 logout(refreshToken) 호출 후 clear', async () => {
    const { store, clearMock } = fakeTokenStore({ refresh: 'ref1' });
    const { client, request } = fakeApiClient({ 'POST /auth/logout': () => undefined });

    await revokeSessionAndClear({ client, tokenStore: store, isWeb: false });

    expect(request).toHaveBeenCalledWith('POST', '/auth/logout', { body: { refreshToken: 'ref1' } });
    expect(clearMock).toHaveBeenCalledTimes(1);
  });

  test('네이티브: refresh 없으면 logout 미호출(대상 세션이 없다), clear는 그대로 호출', async () => {
    const { store, clearMock } = fakeTokenStore({ refresh: null });
    const { client, request } = fakeApiClient({});

    await revokeSessionAndClear({ client, tokenStore: store, isWeb: false });

    expect(request).not.toHaveBeenCalled();
    expect(clearMock).toHaveBeenCalledTimes(1);
  });
});
