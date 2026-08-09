import type { AuthTokens } from '@gachinol/shared';
import type { TokenStore } from '../../auth/token-store';
import { createApiClient } from '../client';
import { ApiClientError, ApiNetworkError } from '../errors';

const BASE = 'http://api.test';

/** 최소 Response 페이크 — json 다회 호출 허용 */
function res(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('비JSON 바디');
      return body;
    },
  } as unknown as Response;
}

function tokensOf(n: number, opts?: { accessTtlMs?: number }): AuthTokens {
  return {
    accessToken: `acc${n}`,
    refreshToken: `ref${n}`,
    accessTokenExpiresAt: new Date(Date.now() + (opts?.accessTtlMs ?? 15 * 60_000)).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  };
}

interface FakeTokenStoreInit {
  access?: string | null;
  accessTtlMs?: number;
  refresh?: string | null;
}

function fakeTokenStore(init: FakeTokenStoreInit = {}) {
  let access = init.access ?? null;
  let accessExpiresAt = access !== null ? Date.now() + (init.accessTtlMs ?? 15 * 60_000) : null;
  let refresh = init.refresh ?? null;
  const clearMock = jest.fn();
  const saveMock = jest.fn();
  const store: TokenStore = {
    async load() {},
    async save(tokens: AuthTokens) {
      saveMock(tokens);
      refresh = tokens.refreshToken;
      access = tokens.accessToken;
      accessExpiresAt = Date.parse(tokens.accessTokenExpiresAt);
    },
    async clear() {
      clearMock();
      access = null;
      accessExpiresAt = null;
      refresh = null;
    },
    getAccessToken: () => access,
    getAccessTokenExpiresAt: () => accessExpiresAt,
    getRefreshToken: () => refresh,
  };
  return { store, clearMock, saveMock };
}

function setup(init: FakeTokenStoreInit = { access: 'acc1', refresh: 'ref1' }) {
  const { store, clearMock, saveMock } = fakeTokenStore(init);
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  const onSessionExpired = jest.fn();
  const client = createApiClient({
    baseUrl: BASE,
    tokenStore: store,
    onSessionExpired,
    fetchFn: fetchMock as unknown as typeof fetch,
  });
  return { client, store, fetchMock, onSessionExpired, clearMock, saveMock };
}

const isRefreshCall = (url: string): boolean => url === `${BASE}/v1/auth/refresh`;

describe('createApiClient', () => {
  test('① 200 파싱 + Bearer 첨부 + /v1 프리픽스 + 쿼리 undefined 생략', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(res(200, { items: [] }));

    const result = await client.request('GET', '/contents', {
      query: { page: 1, pageSize: undefined, status: 'draft' },
    });

    expect(result).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/v1/contents?page=1&status=draft`);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer acc1');
  });

  test('② 204 → undefined', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(res(204));
    await expect(
      client.request('POST', '/auth/logout', { body: { refreshToken: 'x' } }),
    ).resolves.toBeUndefined();
  });

  test('③ 에러 바디 → ApiClientError(status, ApiError)', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(
      res(404, { code: 'not_found', message: '콘텐츠를 찾을 수 없습니다' }),
    );
    const err = await client.request('GET', '/contents/none').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(404);
    expect((err as ApiClientError).error).toEqual({
      code: 'not_found',
      message: '콘텐츠를 찾을 수 없습니다',
    });
  });

  test('④ 비JSON 에러 폴백 — internal 합성', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(res(500)); // json() throw
    const err = await client.request('GET', '/contents').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).error).toEqual({ code: 'internal', message: '응답 파싱 실패' });
  });

  test('⑤ 401 → refresh(저장된 refreshToken 바디) → 새 access로 재시도 1회 성공 + 회전 쌍 저장', async () => {
    const { client, store, fetchMock, saveMock } = setup();
    const rotated = tokensOf(2);
    fetchMock.mockImplementation(async (url, init) => {
      if (isRefreshCall(url)) {
        expect(JSON.parse(init?.body as string)).toEqual({ refreshToken: 'ref1' });
        return res(200, rotated);
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer acc2'
        ? res(200, { ok: true })
        : res(401, { code: 'unauthorized', message: '만료' });
    });

    await expect(client.request('GET', '/contents')).resolves.toEqual({ ok: true });
    expect(saveMock).toHaveBeenCalledWith(rotated);
    expect(store.getAccessToken()).toBe('acc2');
    expect(store.getRefreshToken()).toBe('ref2');
    // 요청 → refresh → 재시도 = 3회
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('⑥ 동시 401 3건 → refresh 정확히 1회(single-flight), 3건 모두 재시도 성공', async () => {
    const { client, fetchMock } = setup();
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url, init) => {
      if (isRefreshCall(url)) {
        refreshCalls += 1;
        return res(200, tokensOf(2));
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer acc2'
        ? res(200, { ok: true })
        : res(401, { code: 'unauthorized', message: '만료' });
    });

    const results = await Promise.all([
      client.request('GET', '/contents'),
      client.request('GET', '/contents/a'),
      client.request('GET', '/contents/b'),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
  });

  test('⑦ 재시도 후에도 401 → 추가 refresh 없이 실패 (무한루프 방지)', async () => {
    const { client, fetchMock } = setup();
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url) => {
      if (isRefreshCall(url)) {
        refreshCalls += 1;
        return res(200, tokensOf(2));
      }
      return res(401, { code: 'unauthorized', message: '만료' });
    });

    const err = await client.request('GET', '/contents').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(401);
    expect(refreshCalls).toBe(1);
  });

  test('⑧ refresh 401 → clear() + onSessionExpired 정확히 1회', async () => {
    const { client, fetchMock, clearMock, onSessionExpired } = setup();
    fetchMock.mockImplementation(async (url) => {
      if (isRefreshCall(url)) return res(401, { code: 'unauthorized', message: '재사용 탐지' });
      return res(401, { code: 'unauthorized', message: '만료' });
    });

    const err = await client.request('GET', '/contents').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(clearMock).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  test('⑨ refresh 네트워크 예외 → clear 미호출 (토큰 보존)', async () => {
    const { client, store, fetchMock, clearMock, onSessionExpired } = setup();
    fetchMock.mockImplementation(async (url) => {
      if (isRefreshCall(url)) throw new TypeError('Network request failed');
      return res(401, { code: 'unauthorized', message: '만료' });
    });

    const err = await client.request('GET', '/contents').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiNetworkError);
    expect(clearMock).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(store.getRefreshToken()).toBe('ref1');
  });

  test('⑩ 선제 refresh — access 만료 30초 전이면 요청 전에 회전', async () => {
    // access가 10초 뒤 만료 → 스큐(30초) 이내 → 선제 refresh
    const { client, fetchMock } = setup({ access: 'acc1', accessTtlMs: 10_000, refresh: 'ref1' });
    const order: string[] = [];
    fetchMock.mockImplementation(async (url, init) => {
      if (isRefreshCall(url)) {
        order.push('refresh');
        return res(200, tokensOf(2));
      }
      order.push('request');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer acc2');
      return res(200, { ok: true });
    });

    await expect(client.request('GET', '/contents')).resolves.toEqual({ ok: true });
    expect(order).toEqual(['refresh', 'request']);
  });

  test('access·refresh 모두 없으면 즉시 unauthorized (fetch 미호출)', async () => {
    const { client, fetchMock } = setup({ access: null, refresh: null });
    const err = await client.request('GET', '/contents').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe('unauthorized');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * 웹 분기 (T-W2-04) — 조율자 경고 3항목 회귀 고정:
 *  ① doRefresh()가 getRefreshToken() falsy(웹은 항상 null)면 네트워크 호출조차 안 함
 *  ② doFetch에 credentials:'include'·X-Requested-With 부재
 *  ③ (auth-context.tsx 소관) bootstrap()이 쿠키 세션이 있어도 무조건 signedOut 판정
 * ①·②는 여기서, ③은 client.ts가 제공하는 메커니즘(ensureFreshTokens가 실제로 쿠키를 태워 성사되는지)을
 * 검증함으로써 간접 고정한다 — auth-context.tsx는 이 메커니즘 위에 얇게 얹혀 있을 뿐이라 별도 훅 테스트
 * 인프라(@testing-library/react-native 등, 이 리포에 없음 = 신규 의존성)가 없어도 핵심 로직은 여기서 잠근다.
 *
 * [게이트②-재기동] 독립 검증자가 실행으로 재현: 웹 refresh 5xx가 항상 signedOut으로 오판정됐다 —
 * `ensureFreshTokens()`가 boolean만 반환해 호출부(`auth-context.tsx` bootstrap)가 실패 원인(401 vs 5xx)을
 * `tokenStore.getRefreshToken()`으로 되짚었는데, 그 값이 웹에서는 성공·401·5xx 무관하게 항상 null이라
 * 재구성이 무너졌다. `RefreshOutcome`('ok'|'signed-out'|'error') 3치를 직접 반환하도록 승격해 재구성
 * 자체를 없앴다(`apps/reporter` T-W2-19 동형). 아래 ①⑥⑦는 반환값 표기를 boolean→3치로 갱신했고,
 * ⑧(웹 5xx)과 네이티브 무회귀 블록의 5xx·401 케이스 2건을 신규로 고정한다.
 * ══════════════════════════════════════════════════════════════════════════
 */
function setupWeb(init: FakeTokenStoreInit = { access: null, refresh: null }) {
  const { store, clearMock, saveMock } = fakeTokenStore(init);
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  const onSessionExpired = jest.fn();
  const client = createApiClient({
    baseUrl: BASE,
    tokenStore: store,
    onSessionExpired,
    fetchFn: fetchMock as unknown as typeof fetch,
    platformOS: 'web',
  });
  return { client, store, fetchMock, onSessionExpired, clearMock, saveMock };
}

/** 서버 `WebSessionResponse`(auth.controller.ts) 형태 — refresh 원문 없음(HttpOnly 쿠키 전용) */
function webSessionBody(n: number, opts?: { accessTtlMs?: number }) {
  return {
    accessToken: `acc${n}`,
    accessTokenExpiresAt: new Date(Date.now() + (opts?.accessTtlMs ?? 15 * 60_000)).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  };
}

describe('createApiClient(web) — T-W2-04', () => {
  test('① refresh: getRefreshToken() null이어도 네트워크 호출 발생 + /auth/web/refresh + credentials·CSRF 헤더 + 바디 없음', async () => {
    const { client, store, fetchMock, saveMock } = setupWeb({ access: null, refresh: null });
    fetchMock.mockImplementation(async (url, init) => {
      expect(url).toBe(`${BASE}/v1/auth/web/refresh`);
      expect(init?.credentials).toBe('include');
      expect((init?.headers as Record<string, string>)['X-Requested-With']).toBeTruthy();
      // 웹은 쿠키만 본다 — 바디에 토큰을 싣지 않는다(서버가 의도적으로 무시하는 계약, 애초에 안 보냄)
      expect(init?.body).toBeUndefined();
      return res(200, webSessionBody(1));
    });

    await expect(client.ensureFreshTokens()).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'acc1' }));
    expect(store.getAccessToken()).toBe('acc1');
  });

  test('② 로그인: /auth/login → /auth/web/login 치환 + 평평한 웹 응답을 {user, tokens} 형태로 변환', async () => {
    const { client, fetchMock } = setupWeb();
    fetchMock.mockImplementation(async (url, init) => {
      expect(url).toBe(`${BASE}/v1/auth/web/login`);
      expect(init?.credentials).toBe('include');
      expect((init?.headers as Record<string, string>)['X-Requested-With']).toBeTruthy();
      return res(200, { user: { id: 'u1', email: 'a@b.com' }, ...webSessionBody(1) });
    });

    const result = await client.request('POST', '/auth/login', {
      body: { email: 'a@b.com', password: 'x' },
      auth: false,
    });
    expect(result).toEqual({
      user: { id: 'u1', email: 'a@b.com' },
      tokens: {
        accessToken: 'acc1',
        accessTokenExpiresAt: expect.any(String),
        refreshTokenExpiresAt: expect.any(String),
        refreshToken: '',
      },
    });
  });

  test('③ 로그아웃: /auth/logout → /auth/web/logout 치환', async () => {
    const { client, fetchMock } = setupWeb({ access: 'acc1', refresh: null });
    fetchMock.mockImplementation(async (url) => {
      expect(url).toBe(`${BASE}/v1/auth/web/logout`);
      return res(204);
    });
    await expect(
      client.request('POST', '/auth/logout', { body: { refreshToken: '' } }),
    ).resolves.toBeUndefined();
  });

  test('④ 일반 GET: credentials:include + X-Requested-With + Bearer 병행 부착', async () => {
    const { client, fetchMock } = setupWeb({ access: 'acc1', refresh: null });
    fetchMock.mockResolvedValueOnce(res(200, { items: [] }));

    await client.request('GET', '/contents');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>)['X-Requested-With']).toBeTruthy();
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer acc1');
  });

  test('⑤ 선제 refresh: getRefreshToken() 무관하게 만료 임박이면 웹은 무조건 트리거', async () => {
    const { client, fetchMock } = setupWeb({ access: 'acc1', accessTtlMs: 10_000, refresh: null });
    const order: string[] = [];
    fetchMock.mockImplementation(async (url, init) => {
      if (url === `${BASE}/v1/auth/web/refresh`) {
        order.push('refresh');
        return res(200, webSessionBody(2));
      }
      order.push('request');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer acc2');
      return res(200, { ok: true });
    });

    await expect(client.request('GET', '/contents')).resolves.toEqual({ ok: true });
    expect(order).toEqual(['refresh', 'request']);
  });

  test('⑥ refresh 401 → \'signed-out\' + clear() + onSessionExpired 정확히 1회(웹도 네이티브와 동일 판정)', async () => {
    const { client, fetchMock, clearMock, onSessionExpired } = setupWeb({
      access: null,
      refresh: null,
    });
    fetchMock.mockResolvedValueOnce(res(401, { code: 'unauthorized', message: '세션이 없습니다' }));

    await expect(client.ensureFreshTokens()).resolves.toBe('signed-out');
    expect(clearMock).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  test('⑦ 새로고침 재현: access 없음·refresh null 상태에서도 ensureFreshTokens→request 왕복 성공(부트스트랩 성공 경로)', async () => {
    const { client, fetchMock } = setupWeb({ access: null, refresh: null });
    fetchMock.mockImplementation(async (url) => {
      if (url === `${BASE}/v1/auth/web/refresh`) return res(200, webSessionBody(1));
      return res(200, { id: 'u1' });
    });

    await expect(client.ensureFreshTokens()).resolves.toBe('ok');
    await expect(client.request('GET', '/auth/me')).resolves.toEqual({ id: 'u1' });
  });

  test("⑧ [게이트②-재기동] refresh 5xx(일시 서버 장애) → 'error' — 'signed-out'으로 오판정하지 않는다, clear·onSessionExpired 미호출", async () => {
    // 독립 검증자 재현 시나리오: 웹은 tokenStore.getRefreshToken()이 성공·401·5xx 무관하게 항상 null이라
    // 그 값으로 실패 원인을 되짚으면 5xx도 signedOut으로 오판정된다(발주-수신 대장 #71 후속 결함).
    // ensureFreshTokens()가 RefreshOutcome을 직접 반환하는 지금은 5xx가 'error'로 명확히 구분되어야 한다.
    const { client, fetchMock, clearMock, onSessionExpired } = setupWeb({
      access: null,
      refresh: null,
    });
    fetchMock.mockResolvedValueOnce(res(503, { code: 'internal', message: '일시 장애' }));

    await expect(client.ensureFreshTokens()).resolves.toBe('error');
    expect(clearMock).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});

describe('createApiClient(native) — 웹 분기 도입 후 무회귀 고정', () => {
  test('credentials·X-Requested-With는 여전히 미부착(기존 동작 그대로)', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(res(200, { items: [] }));

    await client.request('GET', '/contents');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBeUndefined();
    expect((init?.headers as Record<string, string>)['X-Requested-With']).toBeUndefined();
  });

  test("[게이트②-재기동] ensureFreshTokens: refresh 5xx → 'error'(RefreshOutcome 승격 후에도 판정 불변) — 토큰 보존, clear·onSessionExpired 미호출", async () => {
    const { client, store, fetchMock, clearMock, onSessionExpired } = setup({
      access: 'acc1',
      refresh: 'ref1',
    });
    fetchMock.mockResolvedValueOnce(res(503, { code: 'internal', message: '일시 장애' }));

    await expect(client.ensureFreshTokens()).resolves.toBe('error');
    expect(clearMock).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
    // 이전 boolean 시절의 재구성 근거였던 값 — 여전히 보존되어야 한다(무회귀)
    expect(store.getRefreshToken()).toBe('ref1');
  });

  test("[게이트②-재기동] ensureFreshTokens: refresh 401 → 'signed-out'(RefreshOutcome 승격 후에도 판정 불변) — clear·onSessionExpired 정확히 1회", async () => {
    const { client, store, fetchMock, clearMock, onSessionExpired } = setup({
      access: 'acc1',
      refresh: 'ref1',
    });
    fetchMock.mockResolvedValueOnce(res(401, { code: 'unauthorized', message: '재사용 탐지' }));

    await expect(client.ensureFreshTokens()).resolves.toBe('signed-out');
    expect(clearMock).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(store.getRefreshToken()).toBeNull();
  });
});
