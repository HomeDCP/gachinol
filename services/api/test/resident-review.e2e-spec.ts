/**
 * 주민 업로드 검수 반려 → Content 종결 E2E (T-W2-31 — 대장 #112). DB 필요, 없으면 skip.
 *
 * 무엇을 실증하는가: 반려가 `resident_uploads.status`만 바꾸고 끝나던 결함을 닫았다는 것 —
 * 반려 후 그 업로드가 낳은 **Content가 `canceled`로 종결**되고, 그 전이가 시스템 액터로
 * `status_transition_logs`에 남는다. 실 HTTP 왕복 + 실 DB로 본다(목 0).
 *
 * ── 왜 S3를 태우지 않는가 (`describeWithDb`이지 `describeWithS3`가 아닌 이유) ──────────────
 * 익명 업로드 한 바퀴(presign → PUT → 완료 통지)는 실 S3가 있어야 하고, 이 리포의 e2e 하네스는
 * S3 미가용 시 해당 스위트를 통째로 skip한다(`describeWithS3`). 이 스위트가 지키려는 것은
 * **검수 반려의 사후 효과**이므로 S3 가용성에 따라 침묵하면 회귀 방어가 되지 않는다.
 * 그래서 업로드 도착 이후의 커밋된 상태(= `completeUpload`가 한 트랜잭션으로 만드는 것:
 * Content(status='uploaded', origin='resident_link', reporterId=null) + ResidentUpload
 * (status='awaiting_branch_review', contentId 연결))를 Prisma로 직접 만들고, **검수부터는 전부 HTTP**다.
 * 링크 발급만은 인증 표면이라 HTTP로 그대로 태운다.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { createE2eApp, resetDb } from './e2e-app';
import { describeWithDb, e2eDb } from './e2e-db';

const d = describeWithDb();

d('주민 업로드 검수 반려 → 콘텐츠 종결 (withDb)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let reporterToken: string;
  let reporterId: string;
  let aewolId: string;
  let linkId: string;
  /** 테스트 사용자 자격증명은 하네스가 env에서 받은 시드 값을 재사용한다(리터럴 비밀값 금지) */
  const secret = (): string => e2eDb().adminPassword as string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** `completeUpload`가 커밋해 놓는 상태를 그대로 만든다 — 여기서부터가 검수의 입력이다 */
  const seedAwaitingReview = async (
    contentStatus = 'uploaded',
  ): Promise<{ uploadId: string; contentId: string }> => {
    const contentId = uuidv7();
    const uploadId = uuidv7();
    await prisma.content.create({
      data: {
        id: contentId,
        stationId: aewolId,
        origin: 'resident_link', // ⇒ reporterId=null (shared 불변식)
        reporterId: null,
        title: '주민 제보 영상',
        category: 'news',
        cultureTopics: [],
        status: contentStatus,
        priority: 'normal',
        reviewPolicy: 'reporter_then_center',
        generation: 1,
        scenes: [],
        targetChannelAccountIds: [],
        tags: [],
      },
    });
    await prisma.residentUpload.create({
      data: {
        id: uploadId,
        linkId,
        contentId,
        status: 'awaiting_branch_review',
        storageKey: `resident-uploads/${uploadId}/original.mp4`,
        mimeType: 'video/mp4',
        sizeBytes: BigInt(2048),
        uploaderContact: '010-1234-5678',
        consentAgreedAt: new Date(),
        completedAt: new Date(),
      },
    });
    return { uploadId, contentId };
  };

  const cancelLogs = (contentId: string) =>
    prisma.statusTransitionLog.findMany({
      where: { entityType: 'content', entityId: contentId, toStatus: 'canceled' },
    });

  const contentStatusOf = async (contentId: string): Promise<string> =>
    (await prisma.content.findUniqueOrThrow({ where: { id: contentId } })).status;

  beforeAll(async () => {
    await resetDb();
    app = await createE2eApp();
    prisma = new PrismaClient();

    const login = await http()
      .post('/v1/auth/login')
      .send({ email: e2eDb().adminEmail, password: secret() })
      .expect(200);
    adminToken = login.body.tokens.accessToken;

    const stations = await http().get('/v1/stations').set(auth(adminToken)).expect(200);
    aewolId = stations.body.items.find((s: { code: string }) => s.code === 'aewol').id;

    const created = await http()
      .post('/v1/users')
      .set(auth(adminToken))
      .send({
        role: 'reporter',
        name: '애월 검수 담당',
        email: 'resident-review@e2e.local',
        password: secret(),
        stationId: aewolId,
      })
      .expect(201);
    reporterId = created.body.id;

    const rLogin = await http()
      .post('/v1/auth/login')
      .send({ email: 'resident-review@e2e.local', password: secret() })
      .expect(200);
    reporterToken = rLogin.body.tokens.accessToken;

    // 링크 발급은 인증 표면이라 실 HTTP로 태운다(발급 대장 행이 실제로 생겨야 업로드가 붙는다)
    const issued = await http()
      .post('/v1/resident-links')
      .set(auth(reporterToken))
      .send({})
      .expect(201);
    linkId = issued.body.id;
    expect(issued.body.token).toEqual(expect.any(String));
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('검수 대기열에 뜬다 — 반려 전 콘텐츠는 uploaded (결함의 출발 상태)', async () => {
    const { uploadId, contentId } = await seedAwaitingReview();

    const queue = await http().get('/v1/resident-uploads').set(auth(reporterToken)).expect(200);
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(uploadId);
    expect(await contentStatusOf(contentId)).toBe('uploaded');
  });

  it('★★ 반려하면 콘텐츠가 canceled로 종결된다 (대장 #112 — 종전에는 uploaded 영구 잔류)', async () => {
    const { uploadId, contentId } = await seedAwaitingReview();

    const res = await http()
      .post(`/v1/resident-uploads/${uploadId}/reject`)
      .set(auth(reporterToken))
      .expect(200);
    expect(res.body).toMatchObject({ status: 'rejected', reviewedByUserId: reporterId });

    expect(await contentStatusOf(contentId)).toBe('canceled');
  });

  it('★ 종결 전이가 시스템 액터로 감사에 남고, 검수자·업로드는 note로 추적된다', async () => {
    const { uploadId, contentId } = await seedAwaitingReview();
    await http()
      .post(`/v1/resident-uploads/${uploadId}/reject`)
      .set(auth(reporterToken))
      .expect(200);

    const logs = await cancelLogs(contentId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      fromStatus: 'uploaded',
      toStatus: 'canceled',
      actorType: 'system',
      actorUserId: null, // 무주 콘텐츠 — 사용자 액터가 될 수 없다
      jobId: null,
    });
    expect(logs[0]!.note).toContain(reporterId);
    expect(logs[0]!.note).toContain(uploadId);
  });

  it('★ 멱등 — 같은 반려를 두 번 보내도 200이고 상태·감사 로그가 유지된다(중복 종결 없음)', async () => {
    const { uploadId, contentId } = await seedAwaitingReview();

    const first = await http()
      .post(`/v1/resident-uploads/${uploadId}/reject`)
      .set(auth(reporterToken))
      .expect(200);
    const second = await http()
      .post(`/v1/resident-uploads/${uploadId}/reject`)
      .set(auth(reporterToken))
      .expect(200);

    expect(second.body.status).toBe('rejected');
    expect(second.body.reviewedAt).toBe(first.body.reviewedAt); // 최초 결정 보존
    expect(await contentStatusOf(contentId)).toBe('canceled');
    expect(await cancelLogs(contentId)).toHaveLength(1); // 전이 로그가 늘지 않는다
  });

  it('★ 종결이 유실된 건은 같은 반려 호출이 보정한다 (구버전 반려분 복구 경로)', async () => {
    const { uploadId, contentId } = await seedAwaitingReview();
    // T-W2-31 이전에 반려된 건의 모습: 업로드는 rejected인데 콘텐츠는 uploaded에 남아 있다
    await prisma.residentUpload.update({
      where: { id: uploadId },
      data: { status: 'rejected', reviewedByUserId: reporterId, reviewedAt: new Date() },
    });

    await http()
      .post(`/v1/resident-uploads/${uploadId}/reject`)
      .set(auth(reporterToken))
      .expect(200);

    expect(await contentStatusOf(contentId)).toBe('canceled');
  });

  it('★ 콘텐츠가 이미 uploaded를 떠났으면 덮어쓰지 않는다 — 반려 자체는 성공', async () => {
    const { uploadId, contentId } = await seedAwaitingReview('processing');

    await http()
      .post(`/v1/resident-uploads/${uploadId}/reject`)
      .set(auth(reporterToken))
      .expect(200);

    expect(await contentStatusOf(contentId)).toBe('processing');
    expect(await cancelLogs(contentId)).toHaveLength(0);
    // 검수 결정 자체는 커밋됐다(반려는 인프라·상태 사정으로 막히지 않는다)
    expect((await prisma.residentUpload.findUniqueOrThrow({ where: { id: uploadId } })).status).toBe(
      'rejected',
    );
  });

  it('타 지사 기자는 반려할 수 없고(403), 그때 콘텐츠도 건드리지 않는다', async () => {
    const { uploadId, contentId } = await seedAwaitingReview();
    const stations = await http().get('/v1/stations').set(auth(adminToken)).expect(200);
    const otherId = stations.body.items.find((s: { code: string }) => s.code !== 'aewol').id;

    await http()
      .post('/v1/users')
      .set(auth(adminToken))
      .send({
        role: 'reporter',
        name: '타 지사 기자',
        email: 'resident-review-other@e2e.local',
        password: secret(),
        stationId: otherId,
      })
      .expect(201);
    const otherLogin = await http()
      .post('/v1/auth/login')
      .send({ email: 'resident-review-other@e2e.local', password: secret() })
      .expect(200);

    await http()
      .post(`/v1/resident-uploads/${uploadId}/reject`)
      .set(auth(otherLogin.body.tokens.accessToken))
      .expect(403);

    expect(await contentStatusOf(contentId)).toBe('uploaded');
  });
});
