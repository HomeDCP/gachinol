/**
 * 공개 피드 E2E — 익명(무토큰) published 투영·서명 재생 URL·공개 지사 목록·커서 페이지네이션.
 *
 * 인프라: DB만 필요(describeWithDb). 서명은 로컬 HMAC(getSignedUrl)이라 s3rver·네트워크 불요 →
 * beforeAll에서 더미 S3 자격만 주입하면 presignGet이 서명 URL을 발급한다(실 오브젝트 바이트 불요).
 *
 * 무회귀: resetDb는 runSeed만 호출하므로 이 스위트만 seedFeedDemo를 명시 호출한다
 * (contents/media/analysis/auth/smoke 스위트의 seed 상태·단언 불변).
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { describeWithDb } from './e2e-db';

// ★ e2e-app는 AppModule을 로드해 ConfigModule.forRoot(.env 로드+validate)를 IMPORT 시점에
//   실행한다 → 루트 .env의 S3_ACCESS_KEY=(빈 문자열)이 config에 고정된다. beforeAll에서 자격을
//   주입한 뒤 동적 import해야 반영됨(media-pipeline.e2e-spec 선례).

const d = describeWithDb();

const INTERNAL_FEED_KEYS = [
  'reporterId',
  'reviewPolicy',
  'status',
  'targetChannelAccountIds',
  'tags',
  'generation',
  'origin',
  'description',
  'scenes',
  'createdAt',
  'updatedAt',
];

d('feed (public, withDb)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let aewolId: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    // 서명 발급용 더미 S3 자격 — 앱 그래프 동적 import(=ConfigModule.forRoot) 전에 주입.
    // 서명은 로컬 HMAC이라 s3rver·네트워크 불요(실 오브젝트 바이트 부재여도 서명 발급은 동작).
    process.env.S3_ACCESS_KEY = 'e2e-feed-access-key';
    process.env.S3_SECRET_KEY = 'e2e-feed-secret-key';

    // 자격 주입 후 동적 import — 정적 top-level import면 config가 빈 자격으로 고정됨
    const { createE2eApp, resetDb } = await import('./e2e-app');
    const { seedFeedDemo } = await import('../prisma/seed');

    await resetDb(); // runSeed만 (center·aewol·jeju-si + admin)
    prisma = new PrismaClient();
    await seedFeedDemo(prisma); // published 데모 콘텐츠 3건 주입
    const aewol = await prisma.station.findUnique({ where: { code: 'aewol' } });
    aewolId = aewol!.id;

    app = await createE2eApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /v1/feed — 무토큰 200, published 3건, 최신순', async () => {
    const res = await http().get('/v1/feed').expect(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.nextCursor).toBeNull();
    // publishedAt DESC
    const dates = res.body.items.map((i: { publishedAt: string }) => i.publishedAt);
    expect([...dates]).toEqual([...dates].sort().reverse());
  });

  it('내부 필드 미노출', async () => {
    const res = await http().get('/v1/feed').expect(200);
    for (const item of res.body.items) {
      for (const k of INTERNAL_FEED_KEYS) expect(item).not.toHaveProperty(k);
      expect(item).toHaveProperty('contentId');
      expect(item).toHaveProperty('stationName');
    }
  });

  it('커서 페이지네이션 — limit=2 왕복, 중복/누락 0', async () => {
    const p1 = await http().get('/v1/feed').query({ limit: 2 }).expect(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();

    const p2 = await http()
      .get('/v1/feed')
      .query({ limit: 2, cursor: p1.body.nextCursor })
      .expect(200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();

    const ids1 = p1.body.items.map((i: { contentId: string }) => i.contentId);
    const ids2 = p2.body.items.map((i: { contentId: string }) => i.contentId);
    expect(new Set([...ids1, ...ids2]).size).toBe(3); // 중복 없음
  });

  it('필터 — stationId(애월 2건)', async () => {
    const res = await http().get('/v1/feed').query({ stationId: aewolId }).expect(200);
    expect(res.body.items).toHaveLength(2);
    for (const item of res.body.items) expect(item.stationId).toBe(aewolId);
  });

  it('필터 — category=local_weather(1건)', async () => {
    const res = await http().get('/v1/feed').query({ category: 'local_weather' }).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].category).toBe('local_weather');
  });

  it('손상 커서 → 400 validation_failed', async () => {
    const res = await http().get('/v1/feed').query({ cursor: 'garbage!!!@@@' }).expect(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('GET /v1/feed/:id/playback — 서명 재생 URL·포스터·자막', async () => {
    const feed = await http().get('/v1/feed').query({ category: 'news' }).expect(200);
    const id = feed.body.items[0].contentId;

    const res = await http().get(`/v1/feed/${id}/playback`).expect(200);
    expect(res.body.contentId).toBe(id);
    // 서명 파라미터 포함
    expect(res.body.hlsUrl).toMatch(/X-Amz-Signature=/);
    expect(res.body.hlsUrl).toContain('rendition_720p.mp4');
    expect(res.body.posterUrl).toMatch(/X-Amz-Signature=/);
    expect(res.body.durationSec).toBeGreaterThan(0);
    // 자막은 타이밍 있는 장면에서만 파생 (뉴스 콘텐츠 = 타이밍 2 + 미정 1)
    expect(res.body.captions.length).toBeGreaterThan(0);
    for (const cue of res.body.captions) {
      expect(cue.startSec).not.toBeNull();
      expect(cue.endSec).not.toBeNull();
      expect(typeof cue.text).toBe('string');
    }
  });

  it('비published 콘텐츠 → /feed 미노출 & playback 404', async () => {
    const draftId = uuidv7();
    await prisma.content.create({
      data: {
        id: draftId,
        stationId: aewolId,
        origin: 'live_vod',
        reporterId: null,
        title: '초안 — 노출 금지',
        category: 'news',
        status: 'draft',
        priority: 'normal',
        reviewPolicy: 'reporter_only',
        generation: 1,
        durationSec: 50,
      },
    });

    const feed = await http().get('/v1/feed').expect(200);
    const ids = feed.body.items.map((i: { contentId: string }) => i.contentId);
    expect(ids).not.toContain(draftId);

    await http().get(`/v1/feed/${draftId}/playback`).expect(404);
  });

  it('GET /v1/feed/stations — operating+dormant branch만 (center·planned 제외)', async () => {
    const res = await http().get('/v1/feed/stations').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    // 애월·제주시 = dormant branch 2곳. center 제외.
    expect(res.body).toHaveLength(2);
    for (const s of res.body) {
      expect(['operating', 'dormant']).toContain(s.status);
      // StationSummary 축약 — 내부 필드 없음
      expect(s).not.toHaveProperty('kind');
      expect(s).not.toHaveProperty('code');
      expect(s).not.toHaveProperty('sortOrder');
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('region');
    }
    const names = res.body.map((s: { name: string }) => s.name);
    expect(names).not.toContain('제주방송센터');
  });

  it('토큰 없이도 전부 접근 가능(@Public) — 인증 헤더 불요 확인', async () => {
    await http().get('/v1/feed').expect(200);
    await http().get('/v1/feed/stations').expect(200);
  });
});
