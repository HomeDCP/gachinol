import { CloudflareCacheService } from './cloudflare-cache.service';

/**
 * fetch 스파이 안전망(qa-verifier 보강3) — `jest.spyOn(global, 'fetch')`만 걸고 구현을 안 주면
 * 원본 fetch가 그대로 통과해 게이트 회귀 시 이 프로세스가 실제로 api.cloudflare.com에 요청을
 * 보낸다(검증자가 뮤테이션 실행 중 실측). "호출되면 안 된다"고 주장하는 테스트는 항상 이 안전망을
 * 쓴다 — 실수로 호출돼도 즉시 실패(reject)할 뿐 네트워크로 나가지 않는다.
 */
const safeFetchSpy = () =>
  jest
    .spyOn(global, 'fetch')
    .mockRejectedValue(new Error('[test] fetch가 호출되면 안 되는 시나리오 — 안전망 발동'));

const makeConfig = (over: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    CF_ZONE_ID: undefined,
    CF_API_TOKEN: undefined,
    CF_PURGE_TIMEOUT_MS: 5000,
    ...over,
  };
  return { get: (k: string) => values[k] } as never;
};

describe('CloudflareCacheService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('CF_ZONE_ID/CF_API_TOKEN 둘 다 미설정 → enabled=false, purge는 no-op(조용한 성공 위장 없음)', async () => {
    const svc = new CloudflareCacheService(makeConfig());
    expect(svc.enabled).toBe(false);

    // 보강3(qa-verifier) — mockImplementation 없이 spyOn만 하면 게이트가 회귀했을 때 이 스펙이
    // 실제로 api.cloudflare.com에 네트워크 요청을 보낸다(검증자가 뮤테이션 중 실측). 항상 안전망을 깐다.
    const fetchSpy = safeFetchSpy();
    const result = await svc.purge(['https://media.example.com/a.mp4']);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: false, success: false, reason: 'not_configured' });
  });

  it('한쪽만 설정돼도 미설정으로 취급(no-op)', async () => {
    const svc = new CloudflareCacheService(makeConfig({ CF_ZONE_ID: 'zone-1' }));
    expect(svc.enabled).toBe(false);
    const fetchSpy = safeFetchSpy();
    const result = await svc.purge(['https://media.example.com/a.mp4']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.attempted).toBe(false);
  });

  it('대상 URL 0건 → attempted=false(설정 여부와 무관)', async () => {
    const svc = new CloudflareCacheService(
      makeConfig({ CF_ZONE_ID: 'zone-1', CF_API_TOKEN: 'tok' }),
    );
    const fetchSpy = safeFetchSpy();
    const result = await svc.purge([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: false, success: false, reason: 'no_urls' });
  });

  it('둘 다 설정 시 실 API 호출 — 성공(200)이면 attempted·success 모두 true', async () => {
    const svc = new CloudflareCacheService(
      makeConfig({ CF_ZONE_ID: 'zone-1', CF_API_TOKEN: 'tok-1' }),
    );
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200, text: async () => '' } as Response);

    const result = await svc.purge(['https://media.example.com/a.mp4']);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
      }),
    );
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      files: ['https://media.example.com/a.mp4'],
    });
    expect(result).toEqual({ attempted: true, success: true });
  });

  it('HTTP 비정상 응답 → attempted=true·success=false(조용히 성공 위장 안 함)', async () => {
    const svc = new CloudflareCacheService(
      makeConfig({ CF_ZONE_ID: 'zone-1', CF_API_TOKEN: 'tok-1' }),
    );
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' } as Response);

    const result = await svc.purge(['https://media.example.com/a.mp4']);
    expect(result).toEqual({ attempted: true, success: false, reason: 'http_403' });
  });

  it('네트워크 예외 → throw하지 않고 attempted=true·success=false', async () => {
    const svc = new CloudflareCacheService(
      makeConfig({ CF_ZONE_ID: 'zone-1', CF_API_TOKEN: 'tok-1' }),
    );
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    const result = await svc.purge(['https://media.example.com/a.mp4']);
    expect(result).toEqual({ attempted: true, success: false, reason: 'exception' });
  });
});
