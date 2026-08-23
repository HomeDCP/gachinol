/** 콘텐츠 E2E — CRUD·전이·지사 부활 시나리오 (DB 필요, 없으면 skip) */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createE2eApp, resetDb } from './e2e-app';
import { describeWithDb, e2eDb } from './e2e-db';

const d = describeWithDb();

d('contents + stations (withDb)', () => {
  let app: INestApplication;
  let adminToken: string;
  let reporterToken: string;
  let aewolId: string;
  let contentId: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await resetDb();
    app = await createE2eApp();

    const login = await http()
      .post('/v1/auth/login')
      .send({ email: e2eDb().adminEmail, password: e2eDb().adminPassword })
      .expect(200);
    adminToken = login.body.tokens.accessToken;

    // 애월 지사 id 확보
    const stations = await http().get('/v1/stations').set(auth(adminToken)).expect(200);
    aewolId = stations.body.items.find((s: { code: string }) => s.code === 'aewol').id;

    // admin이 애월 기자 생성 → 기자 로그인
    await http()
      .post('/v1/users')
      .set(auth(adminToken))
      .send({
        role: 'reporter',
        name: '애월 기자',
        email: 'reporter@e2e.local',
        password: 'reporter-password',
        stationId: aewolId,
      })
      .expect(201);
    const rLogin = await http()
      .post('/v1/auth/login')
      .send({ email: 'reporter@e2e.local', password: 'reporter-password' })
      .expect(200);
    reporterToken = rLogin.body.tokens.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('기자의 POST /v1/users → 403 (RolesGuard)', async () => {
    const res = await http()
      .post('/v1/users')
      .set(auth(reporterToken))
      .send({ role: 'reporter', name: 'x', email: 'x@e2e.local', password: 'password1' })
      .expect(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('culture인데 cultureTopics 없으면 400 validation_failed', async () => {
    const res = await http()
      .post('/v1/contents')
      .set(auth(reporterToken))
      .send({
        title: '교양 없는 교양',
        category: 'culture',
        scenes: [{ order: 0, caption: '장면', startSec: null, endSec: null }],
      })
      .expect(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('draft 생성 — 서버 규칙(station·reporter 토큰 유래, reviewPolicy 매핑, scene id 부여)', async () => {
    const res = await http()
      .post('/v1/contents')
      .set(auth(reporterToken))
      .send({
        title: '애월 해녀 인터뷰',
        category: 'news',
        scenes: [
          { order: 0, caption: '오프닝', startSec: null, endSec: null },
          { order: 1, caption: '인터뷰', startSec: 0, endSec: 30 },
        ],
      })
      .expect(201);

    contentId = res.body.id;
    expect(res.body.stationId).toBe(aewolId);
    expect(res.body.status).toBe('draft');
    expect(res.body.priority).toBe('normal');
    expect(res.body.reviewPolicy).toBe('reporter_then_center'); // news → 센터 게이트
    expect(res.body.scenes).toHaveLength(2);
    expect(res.body.scenes[0].id).toBeTruthy();
  });

  it('목록 — reporter는 자기 지사 강제 (다른 stationId 쿼리 무시)', async () => {
    const res = await http()
      .get('/v1/contents')
      .query({ stationId: '00000000-0000-7000-8000-000000000000' })
      .set(auth(reporterToken))
      .expect(200);
    expect(res.body.totalCount).toBe(1);
    expect(res.body.items[0].stationName).toBe('애월 마을방송국');
  });

  it('PATCH — draft 수정 + SceneId 보존', async () => {
    const before = await http().get(`/v1/contents/${contentId}`).set(auth(reporterToken));
    const keepId = before.body.content.scenes[0].id;

    const res = await http()
      .patch(`/v1/contents/${contentId}`)
      .set(auth(reporterToken))
      .send({
        title: '애월 해녀 인터뷰 (수정)',
        scenes: [
          { order: 0, caption: '수정된 오프닝', startSec: null, endSec: null },
          { order: 1, caption: '인터뷰', startSec: 0, endSec: 30 },
          { order: 2, caption: '클로징', startSec: null, endSec: null },
        ],
      })
      .expect(200);
    expect(res.body.title).toBe('애월 해녀 인터뷰 (수정)');
    expect(res.body.scenes[0].id).toBe(keepId);
  });

  it('상세 — ContentDetail 합성 형태 (미도입 테이블은 빈 값)', async () => {
    const res = await http().get(`/v1/contents/${contentId}`).set(auth(reporterToken)).expect(200);
    expect(res.body.content.id).toBe(contentId);
    expect(res.body.assets).toEqual([]);
    expect(res.body.revisions).toEqual([]);
    expect(res.body.publications).toEqual([]);
  });

  it('지사 부활 — admin이 애월 dormant→operating + station 전이 로그', async () => {
    const res = await http()
      .post(`/v1/stations/${aewolId}/transitions`)
      .set(auth(adminToken))
      .send({ toStatus: 'operating', note: 'MVP 부활' })
      .expect(200);
    expect(res.body.status).toBe('operating');
    expect(res.body.dormantSince).toBeUndefined();

    const prisma = new PrismaClient();
    try {
      const logs = await prisma.statusTransitionLog.findMany({
        where: { entityType: 'station', entityId: aewolId },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ fromStatus: 'dormant', toStatus: 'operating' });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('범용 transitions로 awaiting_reporter_review까지 수동 진행 (워커 부재 기간)', async () => {
    const path: string[] = [
      'uploading',
      'uploaded',
      'processing',
      'analyzing',
      'preview_generating',
      'awaiting_reporter_review',
    ];
    for (const toStatus of path) {
      const res = await http()
        .post(`/v1/contents/${contentId}/transitions`)
        .set(auth(adminToken))
        .send({ toStatus, note: '수동 진행' })
        .expect(200);
      expect(res.body.status).toBe(toStatus);
    }
  });

  it('기자 approve → reviewPolicy 분기(news: awaiting_center_review), 로그 2건째 system', async () => {
    const res = await http()
      .post(`/v1/contents/${contentId}/approve`)
      .set(auth(reporterToken))
      .expect(200);
    expect(res.body.status).toBe('awaiting_center_review'); // 중간 상태(reporter_approved) 노출 없음
    expect(res.body.approvedByUserId).toBeTruthy();
    expect(res.body.approvedAt).toBeTruthy();

    const logs = await http()
      .get(`/v1/contents/${contentId}/transition-logs`)
      .set(auth(reporterToken))
      .expect(200);
    // 최신순: [0] system 자동 연쇄, [1] 기자 승인
    expect(logs.body.items[0]).toMatchObject({
      fromStatus: 'reporter_approved',
      toStatus: 'awaiting_center_review',
      actorType: 'system',
    });
    expect(logs.body.items[1]).toMatchObject({
      fromStatus: 'awaiting_reporter_review',
      toStatus: 'reporter_approved',
      actorType: 'user',
    });
    expect(logs.body.totalCount).toBe(8); // 수동 6 + 승인 2
  });

  it('draft→published 직행 시도 → 409 invalid_transition + allowed', async () => {
    const draft = await http()
      .post('/v1/contents')
      .set(auth(reporterToken))
      .send({
        title: '두 번째 초안',
        category: 'local_weather',
        scenes: [{ order: 0, caption: '삼춘의 감', startSec: null, endSec: null }],
      })
      .expect(201);

    const res = await http()
      .post(`/v1/contents/${draft.body.id}/transitions`)
      .set(auth(adminToken))
      .send({ toStatus: 'published' })
      .expect(409);
    expect(res.body.code).toBe('invalid_transition');
    expect(res.body.details.allowed).toEqual(['uploading', 'canceled']);
  });

  it('subscriber role은 contents API 전체 403', async () => {
    await http()
      .post('/v1/users')
      .set(auth(adminToken))
      .send({
        role: 'subscriber',
        name: '구독자',
        email: 'sub@e2e.local',
        password: 'subscriber-pass',
      })
      .expect(201);
    const sLogin = await http()
      .post('/v1/auth/login')
      .send({ email: 'sub@e2e.local', password: 'subscriber-pass' })
      .expect(200);
    await http().get('/v1/contents').set(auth(sLogin.body.tokens.accessToken)).expect(403);
  });

  /* ════════════════════════════════════════════════════════════════════════════
   * 미성년자 동의 게이트 — 실 HTTP 루프 (대장 #119 · 07 §3-3 · 02 §E-20)
   *
   * 왜 e2e여야 하는가: 단위 스펙 26건은 Prisma를 목으로 대체하므로 **라우트 배선·RBAC 가드·
   * 실 DB 제약**을 통과하는지 못 덮는다. 게이트②가 이 루프를 임시 하네스로 돌려 통과를 확인했으나
   * 그 스펙이 리포에 남지 않아 **CI가 법적 게이트를 지키지 않는 상태**였다.
   * 07이 이 게이트를 최상위 블로커로 다루므로 회귀 비용이 일반 e2e 공백보다 크다.
   *
   * reviewPolicy 두 갈래를 **모두** 밟는다 — policyGuard ④가 지키는 엣지가 정책별로 다르기 때문이다:
   *   · reporter_then_center(news)  → 센터 승인(awaiting_center_review→center_approved)이 "승인"
   *   · reporter_only(local_weather) → 기자 종단 승인(awaiting_reporter_review→reporter_approved)이 "승인"
   * 한쪽만 검증하면 다른 쪽 가드가 조용히 사라져도 CI가 통과한다.
   *
   * 확인 액터는 **center_operator 실계정**이다 — admin으로 대신하면 "센터는 확인할 수 있다"는
   * 주장을 admin 하나로 때우게 되어, 대장 #106("테스트 이름이 입력보다 강하게 주장")과 동형이 된다.
   * ════════════════════════════════════════════════════════════════════════════ */
  describe('미성년자 동의 게이트 (#119 — 승인 차단 → 센터 확인 → 승인 통과)', () => {
    let centerToken: string;

    /** draft 생성 → 플래그 켬 → 지정 상태까지 수동 전이 */
    const armed = async (category: string, upTo: string[]): Promise<string> => {
      const draft = await http()
        .post('/v1/contents')
        .set(auth(reporterToken))
        .send({
          title: `미성년자 등장 (${category})`,
          category,
          scenes: [{ order: 0, caption: '마을 행사', startSec: null, endSec: null }],
        })
        .expect(201);
      const id = draft.body.id;

      // 플래그는 초안 작성자(담당 기자)만 켤 수 있다 — 03 §C-2-1 입력 UX의 서버 측 계약
      const patched = await http()
        .patch(`/v1/contents/${id}`)
        .set(auth(reporterToken))
        .send({ hasMinorSubject: true })
        .expect(200);
      expect(patched.body.hasMinorSubject).toBe(true);

      for (const toStatus of upTo) {
        await http()
          .post(`/v1/contents/${id}/transitions`)
          .set(auth(adminToken))
          .send({ toStatus, note: '수동 진행(워커 부재)' })
          .expect(200);
      }
      return id;
    };

    beforeAll(async () => {
      // 자격은 e2e 하네스 env에서 온다 — 스펙에 새 리터럴을 박지 않는다
      const credential = e2eDb().adminPassword!;
      await http()
        .post('/v1/users')
        .set(auth(adminToken))
        .send({
          role: 'center_operator',
          name: '센터 운영자',
          email: 'center@e2e.local',
          password: credential,
        })
        .expect(201);
      const cLogin = await http()
        .post('/v1/auth/login')
        .send({ email: 'center@e2e.local', password: credential })
        .expect(200);
      centerToken = cLogin.body.tokens.accessToken;
    });

    it('reporter_then_center: 미확인 상태의 센터 승인이 차단된다 (fail-closed)', async () => {
      const id = await armed('news', [
        'uploading',
        'uploaded',
        'processing',
        'analyzing',
        'preview_generating',
        'awaiting_reporter_review',
      ]);
      // 기자 승인은 통과해야 한다 — 게이트의 1차 대상은 센터 승인 단계다(policyGuard ④ 주석)
      await http().post(`/v1/contents/${id}/approve`).set(auth(reporterToken)).expect(200);

      const blocked = await http()
        .post(`/v1/contents/${id}/approve`)
        .set(auth(centerToken))
        .expect(409);
      expect(blocked.body.code).toBe('invalid_transition');
    });

    it('RBAC: 기자는 자기 콘텐츠라도 동의를 확인할 수 없다 (촬영자≠확인자)', async () => {
      const id = await armed('news', ['uploading', 'uploaded']);
      const res = await http()
        .post(`/v1/contents/${id}/minor-consent`)
        .set(auth(reporterToken))
        .expect(403);
      expect(res.body.code).toBe('forbidden');
    });

    it('전체 루프: 차단 → 센터 확인 → 승인 통과 (reporter_then_center)', async () => {
      const id = await armed('news', [
        'uploading',
        'uploaded',
        'processing',
        'analyzing',
        'preview_generating',
        'awaiting_reporter_review',
      ]);
      await http().post(`/v1/contents/${id}/approve`).set(auth(reporterToken)).expect(200);
      await http().post(`/v1/contents/${id}/approve`).set(auth(centerToken)).expect(409);

      const confirmed = await http()
        .post(`/v1/contents/${id}/minor-consent`)
        .set(auth(centerToken))
        .expect(200);
      expect(confirmed.body.minorConsentConfirmedAt).toBeTruthy();
      expect(confirmed.body.minorConsentConfirmedByUserId).toBeTruthy();

      // 확인이 실 DB에 커밋된 뒤에는 같은 승인이 통과한다
      const approved = await http()
        .post(`/v1/contents/${id}/approve`)
        .set(auth(centerToken))
        .expect(200);
      expect(approved.body.status).not.toBe('awaiting_center_review');
    });

    it('멱등: 두 번째 확인은 최초 확인자·시각을 덮어쓰지 않는다 (#116 귀속 보존)', async () => {
      const id = await armed('news', ['uploading', 'uploaded']);
      const first = await http()
        .post(`/v1/contents/${id}/minor-consent`)
        .set(auth(centerToken))
        .expect(200);
      const second = await http()
        .post(`/v1/contents/${id}/minor-consent`)
        .set(auth(adminToken)) // 다른 액터가 뒤늦게 확인을 시도
        .expect(200);

      expect(second.body.minorConsentConfirmedByUserId).toBe(
        first.body.minorConsentConfirmedByUserId,
      );
      expect(second.body.minorConsentConfirmedAt).toBe(first.body.minorConsentConfirmedAt);
    });

    it('철회: 게이트 통과 전에는 되고, 통과 후에는 409 (D5 거짓 안심 금지)', async () => {
      const id = await armed('news', ['uploading', 'uploaded']);
      await http().post(`/v1/contents/${id}/minor-consent`).set(auth(centerToken)).expect(200);

      const withdrawn = await http()
        .delete(`/v1/contents/${id}/minor-consent`)
        .set(auth(centerToken))
        .expect(200);
      expect(withdrawn.body.minorConsentConfirmedAt).toBeNull();

      // 게이트를 실제로 통과시킨 뒤에는 철회가 막힌다
      await http().post(`/v1/contents/${id}/minor-consent`).set(auth(centerToken)).expect(200);
      for (const toStatus of [
        'processing',
        'analyzing',
        'preview_generating',
        'awaiting_reporter_review',
      ]) {
        await http()
          .post(`/v1/contents/${id}/transitions`)
          .set(auth(adminToken))
          .send({ toStatus })
          .expect(200);
      }
      await http().post(`/v1/contents/${id}/approve`).set(auth(reporterToken)).expect(200);
      await http().post(`/v1/contents/${id}/approve`).set(auth(centerToken)).expect(200);

      const res = await http()
        .delete(`/v1/contents/${id}/minor-consent`)
        .set(auth(centerToken))
        .expect(409);
      expect(res.body.code).toBe('conflict');
    });

    it('reporter_only: 기자 종단 승인도 같은 게이트가 잡는다 (센터 검토가 없는 경로)', async () => {
      const id = await armed('local_weather', [
        'uploading',
        'uploaded',
        'processing',
        'analyzing',
        'preview_generating',
        'awaiting_reporter_review',
      ]);

      const blocked = await http()
        .post(`/v1/contents/${id}/approve`)
        .set(auth(reporterToken))
        .expect(409);
      expect(blocked.body.code).toBe('invalid_transition');

      await http().post(`/v1/contents/${id}/minor-consent`).set(auth(centerToken)).expect(200);
      await http().post(`/v1/contents/${id}/approve`).set(auth(reporterToken)).expect(200);
    });

    it('D3 fail-closed: 플래그를 내리면 확인 기록도 함께 지워진다 (켬→확인→끔→켬 우회 차단)', async () => {
      const id = await armed('news', []); // draft 유지 — PATCH 가능 상태
      await http().post(`/v1/contents/${id}/minor-consent`).set(auth(centerToken)).expect(200);

      const off = await http()
        .patch(`/v1/contents/${id}`)
        .set(auth(reporterToken))
        .send({ hasMinorSubject: false })
        .expect(200);
      expect(off.body.hasMinorSubject).toBe(false);
      expect(off.body.minorConsentConfirmedAt).toBeNull();

      const on = await http()
        .patch(`/v1/contents/${id}`)
        .set(auth(reporterToken))
        .send({ hasMinorSubject: true })
        .expect(200);
      expect(on.body.minorConsentConfirmedAt).toBeNull(); // 되켜도 확인은 되살아나지 않는다
    });
  });
});
