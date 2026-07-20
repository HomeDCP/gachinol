/** 인증 E2E — 로그인·회전·재사용 탐지·로그아웃 (DB 필요, 없으면 skip) */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp, resetDb } from './e2e-app';
import { describeWithDb, e2eDb } from './e2e-db';

const d = describeWithDb();

d('auth (withDb)', () => {
  let app: INestApplication;
  const creds = () => ({
    email: e2eDb().adminEmail!,
    password: e2eDb().adminPassword!,
  });

  beforeAll(async () => {
    await resetDb();
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = () => request(app.getHttpServer()).post('/v1/auth/login').send(creds());

  it('시드 admin 로그인 → user + 토큰쌍(ISO 절대 만료)', async () => {
    const res = await login().expect(200);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(new Date(res.body.tokens.refreshTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('오답 로그인 → 401 unauthorized', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: creds().email, password: 'wrong-password' })
      .expect(401);
    expect(res.body.code).toBe('unauthorized');
  });

  it('refresh 회전 → 새 토큰쌍, 구 토큰 재사용 → 401 + family 폐기', async () => {
    const { body } = await login().expect(200);
    const first = body.tokens.refreshToken;

    // 정상 회전
    const rotated = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: first })
      .expect(200);
    const second = rotated.body.refreshToken;
    expect(second).not.toBe(first);

    // 구 refresh 재사용 → 재사용 탐지 401
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: first })
      .expect(401);

    // family 전체 폐기 검증 — 회전으로 받은 최신 토큰도 무효
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: second })
      .expect(401);
  });

  it('logout 후 해당 refresh는 401 (해당 family만 폐기 — 다른 기기 세션은 유지)', async () => {
    const deviceA = await login().expect(200);
    const deviceB = await login().expect(200);

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${deviceA.body.tokens.accessToken}`)
      .send({ refreshToken: deviceA.body.tokens.refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: deviceA.body.tokens.refreshToken })
      .expect(401);

    // 다기기: 기기 B의 family는 영향 없음
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: deviceB.body.tokens.refreshToken })
      .expect(200);
  });

  it('GET /v1/auth/me — access 토큰으로 내 정보', async () => {
    const { body } = await login().expect(200);
    const res = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${body.tokens.accessToken}`)
      .expect(200);
    expect(res.body.email).toBe(creds().email.toLowerCase());
  });
});
