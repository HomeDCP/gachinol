import type { ApiClient } from '../client';
import { getMe, login, logout, webLogin, webLogout } from '../auth';

/** ApiClient.request()만 스텁 — 실제 fetch·client 배선은 client.test.ts가 담당 */
function fakeClient(): { client: ApiClient; request: jest.Mock } {
  const request = jest.fn().mockResolvedValue({});
  const client = { request, ensureFreshTokens: jest.fn() } as unknown as ApiClient;
  return { client, request };
}

describe('auth.ts — 네이티브(바디) 경로 무회귀', () => {
  test('login: POST /auth/login, auth:false, 바디에 email/password', async () => {
    const { client, request } = fakeClient();
    await login(client, { email: 'a@b.com', password: 'pw' });
    expect(request).toHaveBeenCalledWith('POST', '/auth/login', {
      body: { email: 'a@b.com', password: 'pw' },
      auth: false,
    });
  });

  test('logout: POST /auth/logout, 바디에 refreshToken (Bearer 첨부는 client가 담당 — auth 기본값 true)', async () => {
    const { client, request } = fakeClient();
    await logout(client, { refreshToken: 'ref1' });
    expect(request).toHaveBeenCalledWith('POST', '/auth/logout', { body: { refreshToken: 'ref1' } });
  });

  test('getMe: GET /auth/me (플랫폼 공통)', async () => {
    const { client, request } = fakeClient();
    await getMe(client);
    expect(request).toHaveBeenCalledWith('GET', '/auth/me');
  });
});

describe('auth.ts — 웹(쿠키) 경로 (대장 #71 결함③)', () => {
  test('webLogin: POST /auth/web/login, auth:false, X-Requested-With 헤더 부착, 바디는 email/password만(refresh 없음)', async () => {
    const { client, request } = fakeClient();
    await webLogin(client, { email: 'a@b.com', password: 'pw' });
    expect(request).toHaveBeenCalledWith('POST', '/auth/web/login', {
      body: { email: 'a@b.com', password: 'pw' },
      auth: false,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  });

  test('webLogout: POST /auth/web/logout, auth:false, X-Requested-With 헤더 부착, 바디 없음(쿠키 전용)', async () => {
    const { client, request } = fakeClient();
    await webLogout(client);
    expect(request).toHaveBeenCalledWith('POST', '/auth/web/logout', {
      auth: false,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  });
});
