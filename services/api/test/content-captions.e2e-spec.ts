/**
 * 사후 자막 보강 E2E (T-W2-34 — 대장 #123 · 정본 03 §C-4 간단 모드).
 *
 * 무엇을 실증하는가 (전부 실 HTTP 왕복 + 실 Postgres):
 *  ① 간단 모드 산출물 — `scenes: []`로 초안이 **생성되고** 업로드 이후 상태까지 파이프라인이 간다.
 *  ② 발견 — `GET /v1/contents?captions=needed`가 그 콘텐츠를 대기열로 잡는다. JSONB `scenes = '[]'`
 *     조건이 실제 Postgres에서 도는지는 **여기서만** 확인된다(단위 테스트는 where 객체 모양만 본다).
 *  ③ 액터 — **같은 지사 다른 기자**가 자막을 채운다(정본이 말하는 "지사 담당자"). 같은 사람이
 *     초안 수정(`PATCH /v1/contents/:id`)을 시도하면 여전히 403이다 — 넓힌 것은 자막뿐이다.
 *  ④ 경계 — 타 지사 기자는 403, 종결된 콘텐츠는 409, order 규칙 위반은 400.
 *  ⑤ 해소 — 자막을 채우면 대기열에서 빠진다(영원히 줄지 않는 유령 항목이 없다).
 *
 * DB 없으면 skip(다른 e2e와 동일 규약). Redis·S3·FFmpeg 전부 불요 — 외부 네트워크 0.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp, resetDb } from './e2e-app';
import { describeWithDb, e2eDb } from './e2e-db';

const d = describeWithDb();

/** 테스트 계정 자격 — 시크릿 아님(로컬 테스트 DB 전용, 시드 계정과 동일 등급) */
const PW = 'e2e-repo-pw';

d('사후 자막 보강 (withDb)', () => {
  let app: INestApplication;
  let adminToken: string;
  /** 애월 기자 A — 간단 모드로 촬영본을 올린 사람 */
  let ownerToken: string;
  /** 애월 기자 B — 같은 지사 동료(담당 아님). 정본이 말하는 "지사 담당자" */
  let colleagueToken: string;
  /** 제주시 기자 C — 타 지사 */
  let otherStationToken: string;
  let contentId: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const createReporter = async (
    email: string,
    name: string,
    stationId: string,
  ): Promise<string> => {
    await http()
      .post('/v1/users')
      .set(auth(adminToken))
      .send({ role: 'reporter', name, email, password: PW, stationId })
      .expect(201);
    const login = await http().post('/v1/auth/login').send({ email, password: PW }).expect(200);
    return login.body.tokens.accessToken as string;
  };

  beforeAll(async () => {
    await resetDb();
    app = await createE2eApp();

    const login = await http()
      .post('/v1/auth/login')
      .send({ email: e2eDb().adminEmail, password: e2eDb().adminPassword })
      .expect(200);
    adminToken = login.body.tokens.accessToken;

    const stations = await http().get('/v1/stations').set(auth(adminToken)).expect(200);
    const branches = stations.body.items.filter((s: { kind: string }) => s.kind === 'branch');
    const aewolId = branches.find((s: { code: string }) => s.code === 'aewol').id;
    const otherBranchId = branches.find((s: { code: string }) => s.code !== 'aewol').id;

    ownerToken = await createReporter('caption-owner@e2e.local', '애월 기자 A', aewolId);
    colleagueToken = await createReporter('caption-colleague@e2e.local', '애월 기자 B', aewolId);
    otherStationToken = await createReporter('caption-other@e2e.local', '이웃 지사 기자 C', otherBranchId);
  });

  afterAll(async () => {
    await app.close();
  });

  it('① 간단 모드 — scenes 빈 배열로 초안이 생성된다 (서버가 자막 0을 받아들인다)', async () => {
    const res = await http()
      .post('/v1/contents')
      .set(auth(ownerToken))
      .send({ title: '애월 포구 아침', category: 'local_weather', scenes: [] })
      .expect(201);
    contentId = res.body.id;
    expect(res.body.scenes).toEqual([]);
    expect(res.body.status).toBe('draft');
  });

  it('① 업로드 완료 이후 상태까지 간다 — 자막 0이 파이프라인을 막지 않는다', async () => {
    for (const toStatus of ['uploading', 'uploaded']) {
      const res = await http()
        .post(`/v1/contents/${contentId}/transitions`)
        .set(auth(adminToken))
        .send({ toStatus, note: '수동 진행' })
        .expect(200);
      expect(res.body.status).toBe(toStatus);
    }
  });

  it('② 발견 — captions=needed 대기열에 잡힌다 (실 Postgres JSONB 조건)', async () => {
    const res = await http()
      .get('/v1/contents')
      .query({ captions: 'needed' })
      .set(auth(colleagueToken))
      .expect(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).toContain(contentId);
  });

  it('③ 같은 지사 동료의 초안 수정(PATCH :id)은 여전히 403 — 넓힌 것은 자막뿐', async () => {
    const res = await http()
      .patch(`/v1/contents/${contentId}`)
      .set(auth(colleagueToken))
      .send({ title: '남의 콘텐츠 제목 바꾸기' })
      .expect(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('③ ★ 같은 지사 동료가 자막을 채운다 — 업로드가 끝난 뒤인데도 200', async () => {
    const res = await http()
      .patch(`/v1/contents/${contentId}/captions`)
      .set(auth(colleagueToken))
      .send({
        scenes: [
          { order: 0, caption: '포구에 배가 들어옵니다', startSec: 0, endSec: 8 },
          { order: 1, caption: '삼춘이 그물을 손질합니다', startSec: 8, endSec: 20 },
        ],
      })
      .expect(200);
    expect(res.body.scenes).toHaveLength(2);
    expect(res.body.scenes[0].caption).toBe('포구에 배가 들어옵니다');
    // SceneId는 서버가 발급한다(앱은 보내지 않는다)
    expect(res.body.scenes[0].id).toBeTruthy();
    expect(res.body.scenes[1].id).not.toBe(res.body.scenes[0].id);
    // 자막 외 필드는 그대로다
    expect(res.body.title).toBe('애월 포구 아침');
    expect(res.body.status).toBe('uploaded');
  });

  it('④ ★ 타 지사 기자는 403 — 지사 경계는 자막 경로에서도 살아 있다', async () => {
    const res = await http()
      .patch(`/v1/contents/${contentId}/captions`)
      .set(auth(otherStationToken))
      .send({ scenes: [{ order: 0, caption: '남의 지사 자막', startSec: null, endSec: null }] })
      .expect(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('④ order 규칙 위반은 400 — 초안 생성과 같은 zod 규칙을 그대로 쓴다', async () => {
    const res = await http()
      .patch(`/v1/contents/${contentId}/captions`)
      .set(auth(colleagueToken))
      .send({
        scenes: [
          { order: 0, caption: 'A', startSec: null, endSec: null },
          { order: 2, caption: 'B', startSec: null, endSec: null },
        ],
      })
      .expect(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('⑤ 자막을 채우면 대기열에서 빠진다 (유령 항목 없음)', async () => {
    const res = await http()
      .get('/v1/contents')
      .query({ captions: 'needed' })
      .set(auth(colleagueToken))
      .expect(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).not.toContain(contentId);
  });

  it('④ 종결(canceled)된 콘텐츠는 409 + details.status, 대기열에도 없다', async () => {
    const fresh = await http()
      .post('/v1/contents')
      .set(auth(ownerToken))
      .send({ title: '취소될 콘텐츠', category: 'news', scenes: [] })
      .expect(201);
    await http()
      .post(`/v1/contents/${fresh.body.id}/cancel`)
      .set(auth(ownerToken))
      .send({ note: '오촬영' })
      .expect(200);

    const res = await http()
      .patch(`/v1/contents/${fresh.body.id}/captions`)
      .set(auth(colleagueToken))
      .send({ scenes: [{ order: 0, caption: '뒤늦은 자막', startSec: null, endSec: null }] })
      .expect(409);
    expect(res.body.code).toBe('conflict');
    expect(res.body.details).toMatchObject({ status: 'canceled' });

    const queue = await http()
      .get('/v1/contents')
      .query({ captions: 'needed' })
      .set(auth(colleagueToken))
      .expect(200);
    expect(queue.body.items.map((c: { id: string }) => c.id)).not.toContain(fresh.body.id);
  });

  it('② 자막이 있는 콘텐츠는 대기열에 없다 (정밀 모드 산출물 무회귀)', async () => {
    const precise = await http()
      .post('/v1/contents')
      .set(auth(ownerToken))
      .send({
        title: '정밀 모드 콘텐츠',
        category: 'news',
        scenes: [{ order: 0, caption: '자막 있음', startSec: null, endSec: null }],
      })
      .expect(201);

    const res = await http()
      .get('/v1/contents')
      .query({ captions: 'needed' })
      .set(auth(ownerToken))
      .expect(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).not.toContain(precise.body.id);
  });
});
