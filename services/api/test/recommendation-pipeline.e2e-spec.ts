/**
 * 주간추천 파이프라인 E2E — 생성 → pending_review → 수정요청 → 재생성 → 승인 한 바퀴 실증.
 *
 * 인프라 조달(정직 보고 규약):
 *  - Postgres: 기존 e2e 하네스(global-setup) 재사용. **S3·FFmpeg·ai-worker 전부 불요**
 *              (추천은 기존 ai_analyses.recommendation_score 재사용 — 실 ML 재랭킹 없음).
 *  - Redis:    redis-memory-server(인프로세스 실 Redis)를 **시도**한다.
 *              · 성공 → 실 BullMQ **큐 경로**(api 인프로세스 추천 워커 + QueueEvents 소비)
 *              · 실패 → REDIS_URL 미설정 **인라인 폴백 경로**(생산자가 그 자리에서 랭킹·기록)
 *              ★ 어느 쪽이든 스킵 없이 완주한다. 실제 실행 경로는 console.log로 정직 보고한다.
 *  - 외부 네트워크 0.
 *
 * ★ afterAll에서 REDIS_URL을 반드시 삭제한다(maxWorkers=1 공유 프로세스 — analysis-pipeline 교훈).
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import request from 'supertest';
import { describeWithDb, e2eDb } from './e2e-db';

const d = describeWithDb();

/** 대상 주차 — 2026-06-01은 월요일(검증 완료). 윈도우 = [2026-05-31T15:00Z, 2026-06-07T15:00Z) */
const WEEK_OF = '2026-06-01';
/** 수요일 — 서버가 WEEK_OF로 내림 정규화해야 한다 */
const WEEK_WEDNESDAY = '2026-06-03';
/** 고착 복구 검증용 2주차 (월요일) */
const WEEK_2 = '2026-06-08';
/** 재생성 실패 후 재시도 검증용 3주차 (월요일) */
const WEEK_3 = '2026-06-15';

interface Embedded {
  redisUrl: string;
  stop: () => Promise<void>;
}

async function startEmbeddedRedis(): Promise<Embedded | null> {
  // 폴백 경로를 의도적으로 검증하고 싶을 때: REC_E2E_FORCE_INLINE=1
  if (process.env.REC_E2E_FORCE_INLINE === '1') {
    console.warn('[rec-e2e] REC_E2E_FORCE_INLINE=1 — 인라인 폴백 경로 강제');
    return null;
  }
  try {
    const { RedisMemoryServer } = await import('redis-memory-server');
    const redis = new RedisMemoryServer();
    const host = await redis.getHost();
    const port = await redis.getPort();
    return {
      redisUrl: `redis://${host}:${port}`,
      stop: async () => {
        await redis.stop().catch(() => undefined);
      },
    };
  } catch (e) {
    console.warn(
      `[rec-e2e] 인프로세스 Redis 기동 실패 — 인라인 폴백 경로로 진행: ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
}

d('weekly recommendation pipeline (withDb; 큐 or 인라인 폴백)', () => {
  let embedded: Embedded | null = null;
  let app: INestApplication | null = null;
  let prisma: PrismaClient | null = null;
  let adminToken = '';
  let reporterToken = '';
  let aewolId = '';
  let jejuId = '';
  let recommendationId = '';
  const ids: Record<string, string> = {};

  const http = () => request(app!.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** published 콘텐츠 + (옵션) 같은 세대 완료 분석 직접 생성 */
  const seedContent = async (params: {
    key: string;
    stationId: string;
    title: string;
    category?: string;
    status?: string;
    publishedAt?: string;
    score?: number | null;
    summary?: string;
    keywords?: string[];
    withAnalysis?: boolean;
    analysisGeneration?: number;
  }): Promise<string> => {
    const id = uuidv7();
    ids[params.key] = id;
    await prisma!.content.create({
      data: {
        id,
        stationId: params.stationId,
        origin: 'live_vod', // 합성 시드 — reporterId=null 불변식 충족
        reporterId: null,
        title: params.title,
        category: params.category ?? 'news',
        status: params.status ?? 'published',
        priority: 'normal',
        reviewPolicy: 'reporter_only',
        generation: 1,
        scenes: [],
        targetChannelAccountIds: [],
        tags: [],
        durationSec: 120,
        publishedAt: params.publishedAt ? new Date(params.publishedAt) : null,
      },
    });
    if (params.withAnalysis !== false) {
      await prisma!.aiAnalysis.create({
        data: {
          id: uuidv7(),
          contentId: id,
          generation: params.analysisGeneration ?? 1,
          text: {
            transcript: [],
            summary: params.summary ?? '',
            keywords: params.keywords ?? [],
            tags: [],
          },
          recommendationScore: params.score ?? null,
          completedAt: new Date(),
        },
      });
    }
    return id;
  };

  /** 큐 경로는 비동기라 폴링, 인라인 폴백은 즉시 도달(같은 헬퍼로 양쪽 커버) */
  const pollStatus = async (id: string, targets: string[], timeoutMs = 20000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    let status = '';
    for (;;) {
      const row = await prisma!.weeklyRecommendation.findUnique({ where: { id } });
      status = row?.status ?? status;
      if (targets.includes(status) || Date.now() >= deadline) return status;
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  beforeAll(async () => {
    embedded = await startEmbeddedRedis();
    // ★ 빈 문자열 = 명시적 비활성. delete로는 부족하다 — ConfigService가 리포 루트 .env의
    //   REDIS_URL을 읽어 큐를 만들고, 그 Redis가 없으면 인큐가 터진다(폴백이 아니라 실패).
    process.env.REDIS_URL = embedded ? embedded.redisUrl : '';
    console.log(
      `[rec-e2e] 실행 경로: ${embedded ? '실 BullMQ 큐(인프로세스 워커 + QueueEvents)' : '인라인 폴백(REDIS_URL 미설정)'}`,
    );

    const { createE2eApp, resetDb } = await import('./e2e-app');
    await resetDb(); // seedFeedDemo는 호출하지 않는다(주차 충돌 회피 — 픽스처는 스펙 로컬)
    app = await createE2eApp();
    prisma = new PrismaClient();

    const login = await http()
      .post('/v1/auth/login')
      .send({ email: e2eDb().adminEmail, password: e2eDb().adminPassword })
      .expect(200);
    adminToken = login.body.tokens.accessToken;

    const stations = await http().get('/v1/stations').set(auth(adminToken)).expect(200);
    aewolId = stations.body.items.find((s: { code: string }) => s.code === 'aewol').id;
    jejuId = stations.body.items.find((s: { code: string }) => s.code === 'jeju-si').id;

    await http()
      .post('/v1/users')
      .set(auth(adminToken))
      .send({
        role: 'reporter',
        name: '애월 기자(추천E2E)',
        email: 'reporter-rec@e2e.local',
        password: 'reporter-password',
        stationId: aewolId,
      })
      .expect(201);
    const rLogin = await http()
      .post('/v1/auth/login')
      .send({ email: 'reporter-rec@e2e.local', password: 'reporter-password' })
      .expect(200);
    reporterToken = rLogin.body.tokens.accessToken;

    // 후보 픽스처 — A > B > C > D 순, E·F·G는 제외 대상
    await seedContent({
      key: 'A',
      stationId: aewolId,
      title: 'A 애월 해녀 특집',
      publishedAt: '2026-06-02T09:00:00.000Z',
      score: 0.9,
      summary: 'A 요약 문장이다. 두 번째 문장.',
      keywords: ['해녀', '애월'],
    });
    await seedContent({
      key: 'B',
      stationId: jejuId,
      title: 'B 오일장',
      category: 'culture',
      publishedAt: '2026-06-04T09:00:00.000Z',
      score: 0.7,
      keywords: ['오일장'], // summary 없음 → 키워드 분기
    });
    await seedContent({
      key: 'C',
      stationId: jejuId,
      title: 'C 촌장 날씨',
      category: 'local_weather',
      publishedAt: '2026-06-03T09:00:00.000Z',
      score: 0.7, // B와 동점 → publishedAt DESC로 B가 앞
    });
    await seedContent({
      key: 'D',
      stationId: aewolId,
      title: 'D 점수 없음',
      publishedAt: '2026-06-05T09:00:00.000Z',
      score: null, // null→0 → 최하위
    });
    await seedContent({
      key: 'E',
      stationId: aewolId,
      title: 'E 주차 밖(전주 토요일)',
      publishedAt: '2026-05-30T09:00:00.000Z',
      score: 0.99,
    });
    await seedContent({
      key: 'F',
      stationId: aewolId,
      title: 'F 분석 없음',
      publishedAt: '2026-06-02T10:00:00.000Z',
      withAnalysis: false,
    });
    await seedContent({
      key: 'G',
      stationId: aewolId,
      title: 'G 미송출(센터 검토 대기)',
      status: 'awaiting_center_review',
      publishedAt: undefined,
      score: 0.95,
    });
  }, 120000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
    await embedded?.stop().catch(() => undefined);
    delete process.env.REDIS_URL; // ★ 공유 프로세스 오염 방지
  });

  it('① 수요일 날짜로 생성 → weekOf 정규화 · pending_review · 결정적 랭킹(E·F·G 제외)', async () => {
    const res = await http()
      .post('/v1/recommendations')
      .set(auth(adminToken))
      .send({ weekOf: WEEK_WEDNESDAY })
      .expect(200);

    expect(res.body.weekOf).toBe(WEEK_OF); // 서버 정규화
    expect(['generating', 'pending_review']).toContain(res.body.status);
    expect(res.body.generation).toBe(1);
    recommendationId = res.body.id;

    const status = await pollStatus(recommendationId, ['pending_review', 'generation_failed']);
    expect(status).toBe('pending_review');

    const row = (await prisma!.weeklyRecommendation.findUnique({
      where: { id: recommendationId },
    }))!;
    const items = row.items as { contentId: string; rank: number; score?: number; reason: string }[];
    expect(items.map((i) => i.contentId)).toEqual([ids.A, ids.B, ids.C, ids.D]);
    expect(items.map((i) => i.rank)).toEqual([1, 2, 3, 4]);
    expect(items[3]!.score).toBeUndefined(); // score null은 날조하지 않는다
    expect(items[0]!.reason).toBe('A 요약 문장이다. · 키워드: 해녀·애월');
    expect(items[1]!.reason).toBe('키워드: 오일장');
    expect(items[2]!.reason).toContain('AI 요약 없음 — 추천 점수 0.70');
    expect(row.summary).toContain('후보 4건 중 4건 선정');
    expect(row.generatedByJobId).toBe(`recommendation:${recommendationId}:g1`);
  }, 60000);

  it('② 같은 주차 재생성 요청은 409 (200으로 뭉개지 않는다)', async () => {
    const res = await http()
      .post('/v1/recommendations')
      .set(auth(adminToken))
      .send({ weekOf: WEEK_OF })
      .expect(409);
    // 에러 바디가 곧 shared ApiError(봉투 래핑 없음) — details로 상세 유도
    expect(res.body.code).toBe('conflict');
    expect(res.body.details.id).toBe(recommendationId);
    expect(res.body.details.status).toBe('pending_review');
  });

  it('③ 목록 — Paginated<WeeklyRecommendation> + status 필터', async () => {
    const all = await http().get('/v1/recommendations').set(auth(adminToken)).expect(200);
    expect(all.body.totalCount).toBe(1);
    expect(all.body.page).toBe(1);
    expect(all.body.items[0].weekOf).toBe(WEEK_OF);

    const filtered = await http()
      .get('/v1/recommendations?status=approved')
      .set(auth(adminToken))
      .expect(200);
    expect(filtered.body.totalCount).toBe(0);
  });

  it('④ 검토 화면 — rank순 ContentSummary 조인 · 내부 필드 미유출', async () => {
    const res = await http()
      .get(`/v1/recommendations/${recommendationId}`)
      .set(auth(adminToken))
      .expect(200);

    expect(res.body.recommendation.id).toBe(recommendationId);
    expect(res.body.items).toHaveLength(4);
    expect(res.body.items.map((i: { item: { rank: number } }) => i.item.rank)).toEqual([1, 2, 3, 4]);
    expect(res.body.items[0].content.title).toBe('A 애월 해녀 특집');
    expect(res.body.items[0].content.stationName).toBe('애월 마을방송국');
    // ContentSummary 화이트리스트 — 내부·운영 필드 미유출
    expect(res.body.items[0].content.scenes).toBeUndefined();
    expect(res.body.items[0].content.reviewPolicy).toBeUndefined();
    expect(res.body.items[0].content.lastError).toBeUndefined();
  });

  it('⑤ 기자는 전 엔드포인트 403', async () => {
    await http()
      .post('/v1/recommendations')
      .set(auth(reporterToken))
      .send({ weekOf: WEEK_OF })
      .expect(403);
    await http()
      .get(`/v1/recommendations/${recommendationId}`)
      .set(auth(reporterToken))
      .expect(403);
  });

  it('⑥ 수정요청 → regenerating(gen=2) → pending_review · 새 콘텐츠 H 반영 · 수정요청 해소', async () => {
    // 그 사이 published+분석된 H(0.95) — 재생성은 시점 재평가다
    await seedContent({
      key: 'H',
      stationId: aewolId,
      title: 'H 뒤늦게 들어온 특종',
      publishedAt: '2026-06-06T09:00:00.000Z',
      score: 0.95,
    });

    const res = await http()
      .post(`/v1/recommendations/${recommendationId}/request-revision`)
      .set(auth(adminToken))
      .send({ note: '특종을 맨 앞으로 올려주세요' })
      .expect(200);
    expect(['regenerating', 'pending_review']).toContain(res.body.status);
    expect(res.body.generation).toBe(2); // 재생성 세대 +1

    const status = await pollStatus(recommendationId, ['pending_review', 'generation_failed']);
    expect(status).toBe('pending_review');

    const row = (await prisma!.weeklyRecommendation.findUnique({
      where: { id: recommendationId },
    }))!;
    expect(row.generation).toBe(2);
    const items = row.items as { contentId: string; rank: number }[];
    expect(items[0]!.contentId).toBe(ids.H);
    expect(items).toHaveLength(5);
    expect(row.summary).toContain('[재생성 g2 — 수정 지시: 특종을 맨 앞으로 올려주세요]');
    expect(row.generatedByJobId).toBe(`recommendation:${recommendationId}:g2`);

    const revisions = await prisma!.revisionRequest.findMany({
      where: { recommendationId },
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.targetKind).toBe('recommendation');
    expect(revisions[0]!.contentId).toBeNull();
    expect(revisions[0]!.resolvedAt).not.toBeNull();
    expect(revisions[0]!.resolvedByJobId).toBe(`recommendation:${recommendationId}:g2`);
  }, 60000);

  it('⑦ 전이 이력 4종 (entityType=weekly_recommendation, 연쇄 2번째는 system)', async () => {
    const logs = await prisma!.statusTransitionLog.findMany({
      where: { entityType: 'weekly_recommendation', entityId: recommendationId },
    });
    const hops = new Set(logs.map((l) => `${l.fromStatus}->${l.toStatus}`));
    expect(hops.has('generating->pending_review')).toBe(true);
    expect(hops.has('pending_review->revision_requested')).toBe(true);
    expect(hops.has('revision_requested->regenerating')).toBe(true);
    expect(hops.has('regenerating->pending_review')).toBe(true);

    const chained = logs.find((l) => l.toStatus === 'regenerating')!;
    expect(chained.actorType).toBe('system');
    const userHop = logs.find((l) => l.toStatus === 'revision_requested')!;
    expect(userHop.actorType).toBe('user');
    expect(userHop.actorUserId).not.toBeNull();
    expect(userHop.note).toBe('특종을 맨 앞으로 올려주세요');
  });

  it('⑧ 승인 200 → 재승인 409 · approved에서 수정요청 409', async () => {
    const res = await http()
      .post(`/v1/recommendations/${recommendationId}/approve`)
      .set(auth(adminToken))
      .expect(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.approvedByUserId).not.toBeNull();
    expect(res.body.approvedAt).not.toBeNull();

    await http()
      .post(`/v1/recommendations/${recommendationId}/approve`)
      .set(auth(adminToken))
      .expect(409);
    await http()
      .post(`/v1/recommendations/${recommendationId}/request-revision`)
      .set(auth(adminToken))
      .send({ note: '이제 못 고친다' })
      .expect(409);

    // 승인은 송출을 자동 연쇄하지 않는다(범위 밖 — publishing 배선은 후속)
    const row = (await prisma!.weeklyRecommendation.findUnique({
      where: { id: recommendationId },
    }))!;
    expect(row.status).toBe('approved');
    expect(row.publishedAt).toBeNull();
  });

  it('⑨ 실존하지 않는 weekOf는 400 validation_failed — 500 internal이 아니다', async () => {
    for (const weekOf of ['2026-02-31', '2026-13-45', '2026-04-31']) {
      const res = await http()
        .post('/v1/recommendations')
        .set(auth(adminToken))
        .send({ weekOf })
        .expect(400);
      expect(res.body.code).toBe('validation_failed');
    }
  });

  it('⑩ 고착된 진행중 행은 재요청이 되살린다 — week_of unique 주차 영구 차단 방지', async () => {
    await seedContent({
      key: 'I',
      stationId: aewolId,
      title: 'I 2주차 후보',
      publishedAt: '2026-06-09T09:00:00.000Z',
      score: 0.8,
    });
    const created = await http()
      .post('/v1/recommendations')
      .set(auth(adminToken))
      .send({ weekOf: WEEK_2 })
      .expect(200);
    const stuckId: string = created.body.id;
    expect(await pollStatus(stuckId, ['pending_review', 'generation_failed'])).toBe(
      'pending_review',
    );

    // 잡 유실(Redis flush)·프로세스 사망 모사 — 진행중으로 되돌리고 updatedAt을 과거로
    await prisma!.$executeRawUnsafe(
      `UPDATE weekly_recommendations SET status='generating', updated_at = now() - interval '2 hours' WHERE id = $1`,
      stuckId,
    );

    // 재요청이 유일한 복구 진입점 — 이전엔 무조건 409라 DB 직접 수정 외 복구가 불가능했다
    await http()
      .post('/v1/recommendations')
      .set(auth(adminToken))
      .send({ weekOf: WEEK_2 })
      .expect(200);
    expect(await pollStatus(stuckId, ['pending_review', 'generation_failed'])).toBe(
      'pending_review',
    );

    const logs = await prisma!.statusTransitionLog.findMany({
      where: { entityType: 'weekly_recommendation', entityId: stuckId },
    });
    expect(logs.some((l) => l.toStatus === 'generation_failed' && l.note?.includes('생성 고착'))).toBe(
      true,
    );
  }, 60000);

  it('⑪ 재생성 실패 후 재시도는 수정 지시를 다시 싣고 RevisionRequest를 해소한다', async () => {
    await seedContent({
      key: 'J',
      stationId: jejuId,
      title: 'J 3주차 후보',
      publishedAt: '2026-06-16T09:00:00.000Z',
      score: 0.6,
    });
    // 재생성이 실패한 상태(gen 2, generation_failed + 미해소 수정요청)를 조립 — 잡 소진의 산물
    const admin = (await prisma!.user.findFirst({ where: { email: e2eDb().adminEmail } }))!;
    const failedId = uuidv7();
    await prisma!.weeklyRecommendation.create({
      data: {
        id: failedId,
        weekOf: new Date(`${WEEK_3}T00:00:00.000Z`),
        status: 'generation_failed',
        generation: 2,
        items: [],
      },
    });
    const revisionId = uuidv7();
    await prisma!.revisionRequest.create({
      data: {
        id: revisionId,
        targetKind: 'recommendation',
        contentId: null,
        recommendationId: failedId,
        requestedByUserId: admin.id,
        requesterRole: 'center_operator',
        message: '날씨 꼭지를 앞으로',
      },
    });

    await http()
      .post('/v1/recommendations')
      .set(auth(adminToken))
      .send({ weekOf: WEEK_3 })
      .expect(200);
    expect(await pollStatus(failedId, ['pending_review', 'generation_failed'])).toBe(
      'pending_review',
    );

    const row = (await prisma!.weeklyRecommendation.findUnique({ where: { id: failedId } }))!;
    expect(row.generation).toBe(2); // 재시도는 세대를 유지한다
    // 총평 접두 = 센터가 "무엇을 반영한 세대인지" 아는 유일 통로
    expect(row.summary).toContain('[재생성 g2 — 수정 지시: 날씨 꼭지를 앞으로]');

    const revision = (await prisma!.revisionRequest.findUnique({ where: { id: revisionId } }))!;
    expect(revision.resolvedAt).not.toBeNull();
    expect(revision.resolvedByJobId).toBe(`recommendation:${failedId}:g2`);
  }, 60000);
});
