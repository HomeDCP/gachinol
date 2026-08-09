import type { AuthTokens } from '@gachinol/shared';
import { createTokenStore } from '../token-store';

const secureStoreMock = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };

const REFRESH_KEY = 'gachinol.auth.refresh';

const tokens: AuthTokens = {
  accessToken: 'acc-1',
  refreshToken: 'ref-1',
  accessTokenExpiresAt: '2026-07-21T00:15:00.000Z',
  refreshTokenExpiresAt: '2026-08-04T00:00:00.000Z',
};

describe('createTokenStore', () => {
  beforeEach(() => {
    secureStoreMock.__store.clear();
  });

  test('save: SecureStore 영속 완료 후 메모리 반영 + access는 SecureStore에 저장 안 됨 (REFRESH_KEY 단일 키)', async () => {
    const store = createTokenStore();
    await store.save(tokens);

    expect(store.getAccessToken()).toBe('acc-1');
    expect(store.getAccessTokenExpiresAt()).toBe(Date.parse(tokens.accessTokenExpiresAt));
    expect(store.getRefreshToken()).toBe('ref-1');

    // 영속 저장소에는 REFRESH_KEY 단일 키만
    expect([...secureStoreMock.__store.keys()]).toEqual([REFRESH_KEY]);
    const persisted = JSON.parse(secureStoreMock.__store.get(REFRESH_KEY)!) as Record<
      string,
      string
    >;
    expect(persisted.token).toBe('ref-1');
    // access 토큰 값이 영속 페이로드 어디에도 없어야 한다
    expect(secureStoreMock.__store.get(REFRESH_KEY)).not.toContain('acc-1');
  });

  test('load: 영속된 refresh 복원 (access는 메모리 전용이라 null)', async () => {
    const writer = createTokenStore();
    await writer.save(tokens);

    const reader = createTokenStore();
    await reader.load();
    expect(reader.getRefreshToken()).toBe('ref-1');
    expect(reader.getAccessToken()).toBeNull();
    expect(reader.getAccessTokenExpiresAt()).toBeNull();
  });

  test('load: 손상 데이터는 무시 (throw 없이 refresh 없음)', async () => {
    secureStoreMock.__store.set(REFRESH_KEY, '깨진 JSON{');
    const store = createTokenStore();
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.getRefreshToken()).toBeNull();
  });

  test('clear: 영속·메모리 양쪽 소거', async () => {
    const store = createTokenStore();
    await store.save(tokens);
    await store.clear();

    expect(store.getAccessToken()).toBeNull();
    expect(store.getAccessTokenExpiresAt()).toBeNull();
    expect(store.getRefreshToken()).toBeNull();
    expect(secureStoreMock.__store.size).toBe(0);
  });
});

describe('createTokenStore(web) — T-W2-04: expo-secure-store 웹 미지원 → refresh 영속 계층 제거', () => {
  beforeEach(() => {
    secureStoreMock.__store.clear();
  });

  test('save: access만 메모리 반영, refresh는 SecureStore·메모리 어디에도 안 남음(HttpOnly 쿠키가 유일한 원천)', async () => {
    const store = createTokenStore('web');
    await store.save(tokens);

    expect(store.getAccessToken()).toBe('acc-1');
    expect(store.getAccessTokenExpiresAt()).toBe(Date.parse(tokens.accessTokenExpiresAt));
    // 웹은 refresh 원문을 절대 보관하지 않는다 — 정직한 null
    expect(store.getRefreshToken()).toBeNull();
    // SecureStore(웹 미지원 모듈)는 아예 호출되지 않는다 — 영속 저장소에 아무것도 안 쓰임
    expect(secureStoreMock.__store.size).toBe(0);
  });

  test('load: 영속 저장소를 건드리지 않는 no-op(웹은 SecureStore 호출 자체가 없음 — 크래시 회피)', async () => {
    const store = createTokenStore('web');
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.getRefreshToken()).toBeNull();
    expect(store.getAccessToken()).toBeNull();
    expect(secureStoreMock.__store.size).toBe(0);
  });

  test('load: 네이티브 경로가 SecureStore에 남긴 값이 있어도 웹 인스턴스는 절대 복원하지 않는다', async () => {
    const nativeWriter = createTokenStore('ios');
    await nativeWriter.save(tokens);
    expect(secureStoreMock.__store.size).toBe(1); // 전제 확인

    const webReader = createTokenStore('web');
    await webReader.load();
    expect(webReader.getRefreshToken()).toBeNull();
  });

  test('clear: 영속 저장소 호출 없이 메모리만 무효화', async () => {
    const store = createTokenStore('web');
    await store.save(tokens);
    await store.clear();

    expect(store.getAccessToken()).toBeNull();
    expect(store.getAccessTokenExpiresAt()).toBeNull();
    expect(store.getRefreshToken()).toBeNull();
    expect(secureStoreMock.__store.size).toBe(0);
  });

  test('platformOS 미지정 시 기본값은 런타임 Platform.OS — 무인자 호출부(auth-context.tsx)는 기존 동작 무회귀', async () => {
    // jest-expo 프리셋의 기본 테스트 플랫폼(네이티브)에서는 무인자 호출이 여전히 SecureStore 경로를 탄다
    const store = createTokenStore();
    await store.save(tokens);
    expect(secureStoreMock.__store.size).toBe(1);
    expect(store.getRefreshToken()).toBe('ref-1');
  });
});
