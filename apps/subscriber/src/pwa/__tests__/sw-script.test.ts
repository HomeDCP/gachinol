import { SW_SKIP_WAITING_MESSAGE } from '../sw-update-policy';

// Node 전역은 이 앱 tsconfig의 `types`에 없다(RN 전역과 충돌하는 @types/node를 켜지 않는다는 기존 결정).
// 이 스위트만 파일을 읽어야 하므로 필요한 표면만 이 파일 안에서 선언한다.
declare function require(id: string): unknown;
declare const __dirname: string;

const { readFileSync } = require('fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const { join } = require('path') as { join(...parts: string[]): string };

/**
 * `public/sw.js` **동작** 테스트 — T-W1-04.
 *
 * 이 파일은 Metro도 tsc도 jest도 건드리지 않는 구조적 사각지대다(Expo가 바이트 그대로 복사한다).
 * 그대로 두면 서비스워커 본체는 프로젝트에서 유일하게 **아무 보호가 없는 코드**가 된다 — 그래서
 * 소스를 읽어 가짜 ServiceWorkerGlobalScope에 주입하고 실제 이벤트를 흘려 검증한다.
 *
 * 고정하는 불변식:
 *  ① install에서 skipWaiting을 부르지 않는다(자동 적용 금지 — 02 §D-T5 2번의 "자동 강제 새로고침 금지").
 *  ② SKIP_WAITING 메시지를 받았을 때만 skipWaiting한다(앱 상수와 문자열 일치).
 *  ③ activate에서 구 버전 캐시만 청소하고 clients.claim()한다.
 *  ④ 교차 오리진(서명 URL)·`/v1/**` API는 **가로채지 않는다**.
 *  ⑤ 해시 자산은 CacheFirst, 206(Range)은 저장하지 않는다.
 *  ⑥ 문서는 NetworkFirst이고 오프라인일 때만 캐시된 셸을 낸다.
 */

const SW_SOURCE = readFileSync(join(__dirname, '../../../public/sw.js'), 'utf8');
const ORIGIN = 'https://watch.example';
const BUILD_ID = 'abc1234567890def';

type Listener = (event: Record<string, unknown>) => void;

interface FakeResponse {
  status: number;
  clone(): FakeResponse;
  body?: string;
}

function response(status: number, body = 'ok'): FakeResponse {
  const res: FakeResponse = {
    status,
    body,
    clone: () => response(status, body),
  };
  return res;
}

class FakeCache {
  readonly store = new Map<string, FakeResponse>();

  private key(request: string | { url: string }): string {
    return typeof request === 'string' ? request : request.url;
  }

  match(request: string | { url: string }): Promise<FakeResponse | undefined> {
    return Promise.resolve(this.store.get(this.key(request)));
  }

  put(request: string | { url: string }, res: FakeResponse): Promise<void> {
    this.store.set(this.key(request), res);
    return Promise.resolve();
  }
}

class FakeCacheStorage {
  readonly opened = new Map<string, FakeCache>();

  open(name: string): Promise<FakeCache> {
    let cache = this.opened.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.opened.set(name, cache);
    }
    return Promise.resolve(cache);
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.opened.keys()]);
  }

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.opened.delete(name));
  }
}

interface Harness {
  skipWaiting: jest.Mock;
  claim: jest.Mock;
  caches: FakeCacheStorage;
  fetchMock: jest.Mock;
  dispatch(type: string, event: Record<string, unknown>): void;
  /** install/activate의 waitUntil로 넘어온 프라미스 전부 */
  pending: Promise<unknown>[];
}

function loadServiceWorker(): Harness {
  const listeners = new Map<string, Listener[]>();
  const skipWaiting = jest.fn();
  const claim = jest.fn(() => Promise.resolve());
  const cacheStorage = new FakeCacheStorage();
  const fetchMock = jest.fn();
  const pending: Promise<unknown>[] = [];

  const swSelf = {
    location: { href: `${ORIGIN}/sw.js?v=${BUILD_ID}`, origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    skipWaiting,
    clients: { claim },
  };

  // 실 sw.js 소스를 격리 스코프에서 평가한다(테스트 전용 — 프로덕션 경로 아님)
  const factory = new Function('self', 'caches', 'fetch', 'Response', SW_SOURCE);
  factory(swSelf, cacheStorage, fetchMock, { error: () => response(0, 'network-error') });

  return {
    skipWaiting,
    claim,
    caches: cacheStorage,
    fetchMock,
    pending,
    dispatch(type, event) {
      const enriched = {
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
        ...event,
      };
      for (const listener of listeners.get(type) ?? []) listener(enriched);
    },
  };
}

function request(url: string, init: { method?: string; mode?: string } = {}) {
  return { url, method: init.method ?? 'GET', mode: init.mode ?? 'no-cors' };
}

/** respondWith에 넘어온 프라미스를 회수한다 — 호출되지 않았으면 null(= 가로채지 않음) */
function fetchEvent(harness: Harness, req: ReturnType<typeof request>): Promise<unknown> | null {
  let handled: Promise<unknown> | null = null;
  harness.dispatch('fetch', {
    request: req,
    respondWith: (promise: Promise<unknown>) => {
      handled = promise;
    },
  });
  return handled;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('sw.js — 생명주기(자동 적용 금지)', () => {
  it('install에서는 skipWaiting을 부르지 않는다', () => {
    const sw = loadServiceWorker();
    sw.dispatch('install', {});

    expect(sw.skipWaiting).not.toHaveBeenCalled();
  });

  it('SKIP_WAITING 메시지를 받았을 때만 skipWaiting한다', () => {
    const sw = loadServiceWorker();

    sw.dispatch('message', { data: { type: 'PING' } });
    expect(sw.skipWaiting).not.toHaveBeenCalled();

    sw.dispatch('message', { data: SW_SKIP_WAITING_MESSAGE });
    expect(sw.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('activate는 구 버전 캐시만 지우고 clients.claim()한다', async () => {
    const sw = loadServiceWorker();
    await sw.caches.open('gachinol-subscriber-assets-OLDBUILD');
    await sw.caches.open(`gachinol-subscriber-assets-${BUILD_ID}`);
    await sw.caches.open('someone-elses-cache');

    sw.dispatch('activate', {});
    await Promise.all(sw.pending);

    const names = await sw.caches.keys();
    expect(names).toContain(`gachinol-subscriber-assets-${BUILD_ID}`);
    expect(names).toContain('someone-elses-cache'); // 남의 캐시는 건드리지 않는다
    expect(names).not.toContain('gachinol-subscriber-assets-OLDBUILD');
    expect(sw.claim).toHaveBeenCalledTimes(1);
  });
});

describe('sw.js — 캐시하지 않는 것', () => {
  it('교차 오리진(서명 URL·HLS)은 가로채지 않는다', () => {
    const sw = loadServiceWorker();
    const handled = fetchEvent(
      sw,
      request('https://r2.example/renditions/720p.mp4?X-Amz-Expires=900'),
    );

    expect(handled).toBeNull();
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });

  it('API(/v1/**)는 가로채지 않는다 — 서명 URL·피드 목록이 굳으면 안 된다', () => {
    const sw = loadServiceWorker();

    expect(fetchEvent(sw, request(`${ORIGIN}/v1/feed`))).toBeNull();
    expect(fetchEvent(sw, request(`${ORIGIN}/v1/feed/abc/playback`))).toBeNull();
  });

  it('WebSocket 폴링(/socket.io/**)은 가로채지 않는다', () => {
    const sw = loadServiceWorker();

    expect(fetchEvent(sw, request(`${ORIGIN}/socket.io/?EIO=4&transport=polling`))).toBeNull();
  });

  it('GET이 아닌 요청은 가로채지 않는다', () => {
    const sw = loadServiceWorker();

    expect(fetchEvent(sw, request(`${ORIGIN}/`, { method: 'POST', mode: 'navigate' }))).toBeNull();
  });
});

describe('sw.js — 해시 자산 CacheFirst', () => {
  const ASSET = `${ORIGIN}/_expo/static/js/web/entry-${BUILD_ID}.js`;

  it('첫 요청은 네트워크에서 받아 캐시하고, 두 번째는 네트워크를 안 탄다', async () => {
    const sw = loadServiceWorker();
    sw.fetchMock.mockResolvedValue(response(200, 'bundle'));

    await fetchEvent(sw, request(ASSET));
    expect(sw.fetchMock).toHaveBeenCalledTimes(1);

    const second = await fetchEvent(sw, request(ASSET));
    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
    expect((second as FakeResponse).body).toBe('bundle');
  });

  it('206(Range)·오류 응답은 저장하지 않는다', async () => {
    const sw = loadServiceWorker();
    sw.fetchMock.mockResolvedValue(response(206, 'partial'));

    await fetchEvent(sw, request(`${ORIGIN}/assets/clip.mp4`));
    await fetchEvent(sw, request(`${ORIGIN}/assets/clip.mp4`));

    // 저장되지 않았으므로 매번 네트워크를 탄다
    expect(sw.fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('sw.js — 문서 NetworkFirst', () => {
  it('온라인이면 항상 네트워크 응답을 낸다(HTML no-cache 의도 유지)', async () => {
    const sw = loadServiceWorker();
    sw.fetchMock.mockResolvedValue(response(200, 'shell-v1'));

    const first = await fetchEvent(sw, request(`${ORIGIN}/`, { mode: 'navigate' }));
    expect((first as FakeResponse).body).toBe('shell-v1');
    await flush();

    sw.fetchMock.mockResolvedValue(response(200, 'shell-v2'));
    const second = await fetchEvent(sw, request(`${ORIGIN}/watch/abc`, { mode: 'navigate' }));
    expect((second as FakeResponse).body).toBe('shell-v2');
  });

  it('오프라인이면 캐시된 셸을 낸다 — 라우트별로 항목이 쌓이지 않는다', async () => {
    const sw = loadServiceWorker();
    sw.fetchMock.mockResolvedValue(response(200, 'shell'));
    await fetchEvent(sw, request(`${ORIGIN}/watch/abc`, { mode: 'navigate' }));
    await flush();

    sw.fetchMock.mockRejectedValue(new Error('offline'));
    const offline = await fetchEvent(sw, request(`${ORIGIN}/live/xyz`, { mode: 'navigate' }));

    expect((offline as FakeResponse).body).toBe('shell');
    const shellCache = await sw.caches.open(`gachinol-subscriber-shell-${BUILD_ID}`);
    expect([...shellCache.store.keys()]).toEqual(['/']);
  });
});
