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
