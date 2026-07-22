import { createPublicApiClient } from '../client';
import { ApiClientError, ApiNetworkError } from '../errors';

const BASE = 'http://api.test';

/** 최소 Response 페이크 */
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

function setup() {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  const client = createPublicApiClient({
    baseUrl: BASE,
    fetchFn: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock };
}

describe('createPublicApiClient', () => {
  test('① 2xx 파싱 + /v1 프리픽스 + 쿼리 undefined 생략 + Authorization 미부착', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(res(200, { items: [], nextCursor: null }));

    const result = await client.get('/feed', {
      query: { limit: 20, cursor: undefined, stationId: 's1', category: undefined },
    });

    expect(result).toEqual({ items: [], nextCursor: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/v1/feed?limit=20&stationId=s1`);
    const headers = init?.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/json');
    // 익명 클라이언트 — Authorization 헤더가 절대 없어야 한다
    expect(headers.Authorization).toBeUndefined();
    expect(init?.method).toBe('GET');
  });

  test('② 쿼리 없는 경로 — 쿼리스트링 미부착', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(res(200, []));
    await client.get('/feed/stations');
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/v1/feed/stations`);
  });

  test('③ CursorPage passthrough — 런타임 재검증 없이 서버 바디 그대로', async () => {
    const { client, fetchMock } = setup();
    const page = { items: [{ contentId: 'c1' }], nextCursor: 'abc' };
    fetchMock.mockResolvedValueOnce(res(200, page));
    await expect(client.get('/feed')).resolves.toEqual(page);
  });

  test('④ 비2xx(4xx) → ApiClientError(status, ApiError)', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(
      res(404, { code: 'not_found', message: '콘텐츠를 찾을 수 없습니다' }),
    );
    const err = await client.get('/feed/none/playback').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(404);
    expect((err as ApiClientError).error).toEqual({
      code: 'not_found',
      message: '콘텐츠를 찾을 수 없습니다',
    });
  });

  test('⑤ 손상 커서 400 → ApiClientError(validation_failed)', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(
      res(400, { code: 'validation_failed', message: '잘못된 커서' }),
    );
    const err = await client.get('/feed', { query: { cursor: '@@@' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe('validation_failed');
  });

  test('⑥ 비JSON 에러 폴백 — internal 합성', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(res(500));
    const err = await client.get('/feed').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).error).toEqual({ code: 'internal', message: '응답 파싱 실패' });
  });

  test('⑦ fetch throw → ApiNetworkError (세션 판정 없음)', async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const err = await client.get('/feed').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiNetworkError);
  });
});
