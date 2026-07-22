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
