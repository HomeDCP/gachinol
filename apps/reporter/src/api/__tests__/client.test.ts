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

/**
 * 웹(react-native-web) 플랫폼용 페이크 — token-store.ts 웹 분기와 동형: `save()`는 refreshToken을
 * 절대 보관하지 않고, `getRefreshToken()`은 항상 null(HttpOnly 쿠키가 유일 원천이라 구조적으로
 * 값을 가질 수 없다). 일반 `fakeTokenStore`를 그대로 쓰면 이 정직한 null이 재현되지 않아
 * "로컬에 refresh가 없어도 웹은 network을 태운다"는 대장 #71 결함②를 실측할 수 없다.
 */
interface FakeWebTokenStoreInit {
  access?: string | null;
  accessTtlMs?: number;
}

function fakeWebTokenStore(init: FakeWebTokenStoreInit = {}) {
  let access = init.access ?? null;
  let accessExpiresAt = access !== null ? Date.now() + (init.accessTtlMs ?? 15 * 60_000) : null;
  const clearMock = jest.fn();
  const saveMock = jest.fn();
  const store: TokenStore = {
    async load() {},
    async save(tokens: AuthTokens) {
      saveMock(tokens);
      access = tokens.accessToken;
      accessExpiresAt = Date.parse(tokens.accessTokenExpiresAt);
    },
    async clear() {
      clearMock();
      access = null;
      accessExpiresAt = null;
    },
    getAccessToken: () => access,
    getAccessTokenExpiresAt: () => accessExpiresAt,
    getRefreshToken: () => null,
  };
  return { store, clearMock, saveMock };
}

function setupWeb(init: FakeWebTokenStoreInit = {}) {
  const { store, clearMock, saveMock } = fakeWebTokenStore(init);
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

const isWebRefreshCall = (url: string): boolean => url === `${BASE}/v1/auth/web/refresh`;

/** services/api WebSessionResponse 모양(access + 만료 시각들만, refresh 원문 없음 — Set-Cookie 전용) */
function webSessionOf(n: number, opts?: { accessTtlMs?: number }) {
  return {
    accessToken: `acc${n}`,
    accessTokenExpiresAt: new Date(Date.now() + (opts?.accessTtlMs ?? 15 * 60_000)).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  };
}

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

  test('④ 네이티브 무회귀: 요청에 credentials 미부착(웹 전용 동작이 새지 않음)', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(res(200, { ok: true }));
    await client.request('GET', '/contents');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBeUndefined();
  });
});

/**
 * 대장 #71(T-W2-19) — 웹 인증 배선. 3결함 재현·해소를 각각 고정한다:
 * ① 웹 쿠키 세션 부트스트랩 성공 ② refresh가 실제로 네트워크를 호출 ③ 요청에 credentials·CSRF 헤더 부착.
 * 네이티브 경로 무회귀는 위 describe 블록(기존 10건 + 신규 ④)이 담당한다.
 */
describe('createApiClient — 웹(web) 플랫폼 분기 (대장 #71)', () => {
  test('①② 로컬에 refresh가 전혀 없어도(getRefreshToken 항상 null) ensureFreshTokens가 web/refresh를 실제로 호출해 세션 복원', async () => {
    const { client, store, fetchMock, saveMock } = setupWeb({ access: null });
    fetchMock.mockImplementationOnce(async (url, init) => {
      expect(url).toBe(`${BASE}/v1/auth/web/refresh`);
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeUndefined(); // 웹 refresh는 바디를 안 실어보낸다(쿠키만 신뢰)
      return res(200, webSessionOf(9));
    });

    const outcome = await client.ensureFreshTokens();

    expect(outcome).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1); // 결함② 재현 시엔 0회였다 — 이제 실제로 호출된다
    expect(saveMock).toHaveBeenCalledWith({
      accessToken: 'acc9',
      accessTokenExpiresAt: expect.any(String),
      refreshToken: '',
      refreshTokenExpiresAt: expect.any(String),
    });
    expect(store.getAccessToken()).toBe('acc9');
  });

  test('③ web/refresh 요청에 credentials:"include" + X-Requested-With 헤더 부착', async () => {
    const { client, fetchMock } = setupWeb({ access: null });
    fetchMock.mockResolvedValueOnce(res(200, webSessionOf(1)));

    await client.ensureFreshTokens();

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>)['X-Requested-With']).toBe('XMLHttpRequest');
  });

  test('③ 일반 인증 요청(doFetch)에도 credentials:"include" 부착(웹 전체 공통)', async () => {
    const { client, fetchMock } = setupWeb({ access: 'acc1' });
    fetchMock.mockResolvedValueOnce(res(200, { ok: true }));

    await client.request('GET', '/contents');

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBe('include');
  });

  test('web/refresh 401 → clear + onSessionExpired 정확히 1회 + signed-out', async () => {
    const { client, fetchMock, clearMock, onSessionExpired } = setupWeb();
    fetchMock.mockResolvedValueOnce(res(401, { code: 'unauthorized', message: '세션이 없습니다' }));

    const outcome = await client.ensureFreshTokens();

    expect(outcome).toBe('signed-out');
    expect(clearMock).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  test('web/refresh 5xx → error, clear 미호출(토큰 보존 — 부트스트랩이 재시도 화면으로 갈 근거)', async () => {
    const { client, fetchMock, clearMock, onSessionExpired } = setupWeb();
    fetchMock.mockResolvedValueOnce(res(500));

    const outcome = await client.ensureFreshTokens();

    expect(outcome).toBe('error');
    expect(clearMock).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  test('web/refresh 네트워크 예외 → clear 미호출(오프라인 로그아웃 방지, 네이티브와 동일 정책)', async () => {
    const { client, fetchMock, clearMock, onSessionExpired } = setupWeb();
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Network request failed');
    });

    const err = await client.ensureFreshTokens().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiNetworkError);
    expect(clearMock).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  test('access 없어도 인증 요청 시 선제 refresh를 무조건 시도(로컬 refresh 판정 불가 — 결함② 변주)', async () => {
    const { client, fetchMock } = setupWeb({ access: null });
    const order: string[] = [];
    fetchMock.mockImplementation(async (url, init) => {
      if (isWebRefreshCall(url)) {
        order.push('refresh');
        return res(200, webSessionOf(2));
      }
      order.push('request');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer acc2');
      return res(200, { ok: true });
    });

    await expect(client.request('GET', '/contents')).resolves.toEqual({ ok: true });
    expect(order).toEqual(['refresh', 'request']);
  });

  test('보호 라우트 401 → web/refresh 회전 → 재시도 1회 성공(반응형 경로도 동작)', async () => {
    const { client, fetchMock } = setupWeb({ access: 'acc-stale', accessTtlMs: 999_000 });
    fetchMock.mockImplementation(async (url, init) => {
      if (isWebRefreshCall(url)) return res(200, webSessionOf(3));
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer acc3'
        ? res(200, { ok: true })
        : res(401, { code: 'unauthorized', message: '만료' });
    });

    await expect(client.request('GET', '/contents')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3); // 요청 → web/refresh → 재시도
  });
});
