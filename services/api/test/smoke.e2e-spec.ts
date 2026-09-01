/** DB 무관 스모크 — 항상 실행 (PrismaService는 연결 실패에도 부팅) */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp } from './e2e-app';

describe('스모크 (DB 무관)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/liveness → 200 (프리픽스 제외)', async () => {
    await request(app.getHttpServer()).get('/health/liveness').expect(200);
  });

  it('GET /health/version → 200, 프리픽스 붙은 /v1/health/version → 404 (대장 #180 — verify-deployed-sha.mjs가 프리픽스 없는 경로를 전제)', async () => {
    const res = await request(app.getHttpServer()).get('/health/version').expect(200);
    expect(typeof res.body.sha).toBe('string');

    // 두 단언은 서로 다른 실패 모드를 막는다 — 위 200 단언은 exclude 누락(이 결함,
    // 뮤테이션으로 실증)을, 아래 404 단언은 이중 노출(양쪽 경로가 모두 200이 되는 경우)을 잡는다.
    await request(app.getHttpServer()).get('/v1/health/version').expect(404);
  });

  it('무토큰 GET /v1/auth/me → 401 + shared ApiError 형태', async () => {
    const res = await request(app.getHttpServer()).get('/v1/auth/me').expect(401);
    expect(res.body.code).toBe('unauthorized');
    expect(typeof res.body.message).toBe('string');
  });

  it('비프로덕션 GET /docs → 200 (Swagger)', async () => {
    await request(app.getHttpServer()).get('/docs').expect(200);
  });

  it('없는 라우트 → 404 ApiError', async () => {
    const res = await request(app.getHttpServer()).get('/v1/nope').expect(404);
    expect(res.body.code).toBe('not_found');
  });
});
