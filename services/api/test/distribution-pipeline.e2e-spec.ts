/**
 * 다채널 송출 파이프라인 E2E — 센터 트리거 → publish 잡 → Publication published → content published 한 바퀴.
 *
 * 인프라 조달(정직 보고 규약):
 *  - Postgres: 기존 e2e 하네스(global-setup) 재사용(describeWithDb).
 *  - Redis:  redis-memory-server(인프로세스 실 Redis). BullMQ 실 Redis 필수.
 *  - S3:     s3rver(인프로세스 순수 JS S3) — playbackUrl 서명 패킹용(오브젝트 실체 불요, 서명만).
 *  - 카카오: **KakaoMockAdapter**(배포 기본) — 외부 네트워크 0. 실 카카오 미호출.
 *  - 송출 워커: api **인프로세스** DISTRIBUTION_WORKER(REDIS_URL 설정 시 자동 구동) — 별도 프로세스 불요.
 *  - media-worker 불요: 720p rendition 자산을 prisma로 직접 생성(서명 대상만 필요).
 *
 * 정직성: 실 오브젝트 바이트는 부재 — 서명 URL '발급'만 동작. 실 카카오 채널 API는 호출하지 않는다(목).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { v7 as uuidv7 } from 'uuid';
import request from 'supertest';
import { describeWithDb, e2eDb } from './e2e-db';

const d = describeWithDb();

const S3_BUCKET = 'gachinol-media';
const S3_KEY = 'S3RVER';
const S3_SECRET = 'S3RVER';
const CHECKSUM = 'a'.repeat(64);

interface Embedded {
  redisUrl: string;
  s3Endpoint: string;
  stop: () => Promise<void>;
}

async function startEmbedded(): Promise<Embedded | null> {
  try {
    const { RedisMemoryServer } = await import('redis-memory-server');
    const S3rver = (await import('s3rver')).default;

    const redis = new RedisMemoryServer();
    const host = await redis.getHost();
    const port = await redis.getPort();
    const redisUrl = `redis://${host}:${port}`;

    const dir = mkdtempSync(join(tmpdir(), 's3rver-dist-e2e-'));
    const s3port = 9800 + Math.floor(Math.random() * 100);
    const s3 = new S3rver({ port: s3port, address: '127.0.0.1', silent: true, directory: dir });
    await s3.run();
    const s3Endpoint = `http://127.0.0.1:${s3port}`;

    return {
      redisUrl,
      s3Endpoint,
      stop: async () => {
        await s3.close().catch(() => undefined);
        await redis.stop().catch(() => undefined);
      },
    };
  } catch (e) {
    console.warn(
      `[dist-e2e] 인프로세스 Redis/S3 기동 실패 — 스킵: ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
}

d('distribution pipeline (withDb + embedded redis/s3 + kakao mock)', () => {
  let embedded: Embedded | null = null;
  let app: INestApplication | null = null;
  let prisma: PrismaClient | null = null;
  let s3Client: S3Client | null = null;
  let adminToken = '';
  let reporterToken = '';
  let reporterId = '';
  let aewolId = '';
  let jejuId = '';
  const ready = (): boolean => embedded != null && app != null;

  const http = () => request(app!.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** center_approved 콘텐츠 + ready 720p rendition 직접 생성(media-worker 우회) */
  const seedApprovedContent = async (
    stationId: string,
    targetChannelAccountIds: string[] = [],
  ): Promise<string> => {
    const id = uuidv7();
    await prisma!.content.create({
      data: {
        id,
        stationId,
        origin: 'live_vod',
        reporterId: null,
        title: '송출 테스트 콘텐츠',
        category: 'news',
        status: 'center_approved',
        priority: 'normal',
        reviewPolicy: 'reporter_only',
        generation: 1,
        scenes: [],
        targetChannelAccountIds,
        tags: [],
        durationSec: 10,
      },
    });
    await prisma!.mediaAsset.create({
      data: {
        id: uuidv7(),
        ownerKind: 'content',
        contentId: id,
        kind: 'rendition',
        status: 'ready',
        generation: 1,
        bucket: S3_BUCKET,
        storageKey: `contents/${id}/g1/rendition_720p.mp4`,
        mimeType: 'video/mp4',
        width: 1280,
        height: 720,
        durationSec: 10,
        renditionLabel: '720p',
        checksumSha256: CHECKSUM,
      },
    });
    return id;
  };

  /** reporter_only(culture) 콘텐츠를 awaiting_reporter_review로 직접 생성(담당 기자 소유) + ready 720p rendition */
  const seedReporterReviewContent = async (stationId: string): Promise<string> => {
    const id = uuidv7();
    await prisma!.content.create({
      data: {
        id,
        stationId,
        origin: 'reporter_upload',
        reporterId,
        title: '애월 교양 — reporter_only 자동송출',
        category: 'culture',
        cultureTopics: ['food'],
        status: 'awaiting_reporter_review',
        priority: 'normal',
        reviewPolicy: 'reporter_only',
        generation: 1,
        scenes: [],
        targetChannelAccountIds: [],
        tags: [],
        durationSec: 12,
      },
    });
    await prisma!.mediaAsset.create({
      data: {
        id: uuidv7(),
        ownerKind: 'content',
        contentId: id,
        kind: 'rendition',
        status: 'ready',
        generation: 1,
        bucket: S3_BUCKET,
        storageKey: `contents/${id}/g1/rendition_720p.mp4`,
        mimeType: 'video/mp4',
        width: 1280,
        height: 720,
        durationSec: 12,
        renditionLabel: '720p',
        checksumSha256: CHECKSUM,
      },
    });
    return id;
  };

  const pollContentStatus = async (
    contentId: string,
    targets: string[],
    timeoutMs = 30000,
  ): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    let status = 'center_approved';
    while (Date.now() < deadline) {
      const row = await prisma!.content.findUnique({ where: { id: contentId } });
      status = row?.status ?? status;
      if (targets.includes(status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    return status;
  };

  beforeAll(async () => {
    embedded = await startEmbedded();
    if (!embedded) return;

    process.env.REDIS_URL = embedded.redisUrl;
    process.env.S3_ENDPOINT = embedded.s3Endpoint;
    process.env.S3_PUBLIC_ENDPOINT = embedded.s3Endpoint;
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_BUCKET = S3_BUCKET;
    process.env.S3_ACCESS_KEY = S3_KEY;
    process.env.S3_SECRET_KEY = S3_SECRET;
    process.env.S3_FORCE_PATH_STYLE = 'true';

    s3Client = new S3Client({
      region: 'us-east-1',
      endpoint: embedded.s3Endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: S3_KEY, secretAccessKey: S3_SECRET },
    });
    await s3Client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));

    const { createE2eApp, resetDb } = await import('./e2e-app');
    await resetDb();
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

    // reporter_only 자동 송출 시나리오용 — 애월 담당 기자 생성 + 로그인 + id 확보
    await http()
      .post('/v1/users')
      .set(auth(adminToken))
      .send({
        role: 'reporter',
        name: '애월 기자(송출E2E)',
        email: 'reporter-dist@e2e.local',
        password: 'reporter-password',
        stationId: aewolId,
      })
      .expect(201);
    const rLogin = await http()
      .post('/v1/auth/login')
      .send({ email: 'reporter-dist@e2e.local', password: 'reporter-password' })
      .expect(200);
    reporterToken = rLogin.body.tokens.accessToken;
    reporterId = (await prisma!.user.findUnique({ where: { email: 'reporter-dist@e2e.local' } }))!
      .id;
  }, 120000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
    s3Client?.destroy();
    await embedded?.stop().catch(() => undefined);
    delete process.env.REDIS_URL;
  });

  it('정상: distribute → 목 송출 → Publication published & content published (credentialRef 미유출)', async () => {
    if (!ready()) {
      console.warn('[dist-e2e] 인프라 미가용 — 정상 경로 테스트 skip');
      return;
    }
    const contentId = await seedApprovedContent(aewolId); // 지사 기본 kakao 채널(시드됨)

    const res = await http()
      .post(`/v1/contents/${contentId}/distribute`)
      .set(auth(adminToken))
      .send({})
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].status).toBe('queued');
    // 내부 필드 미유출
    expect(res.body[0].credentialRef).toBeUndefined();
    expect(res.body[0].createdAt).toBeUndefined();

    const status = await pollContentStatus(contentId, ['published', 'publish_failed']);
    expect(status).toBe('published');

    const pubs = await prisma!.publication.findMany({ where: { contentId } });
    expect(pubs.length).toBe(1);
    const pub = pubs[0]!;
    expect(pub.status).toBe('published');
    expect(pub.externalPostId).toBe(`kakao_mock_${pub.id}`);
    expect(pub.externalUrl).toContain('https://pf.kakao.com/');
    expect(pub.publishedAt).toBeTruthy();

    // 시스템 전이 로그 publishing→published
    const logs = await prisma!.statusTransitionLog.findMany({
      where: { entityId: contentId, actorType: 'system' },
    });
    const hops = new Set(logs.map((l) => `${l.fromStatus}->${l.toStatus}`));
    expect(hops.has('publishing->published')).toBe(true);

    // GET publications 엔드포인트 + 상세 publications 채움 확인
    const listed = await http()
      .get(`/v1/contents/${contentId}/publications`)
      .set(auth(adminToken))
      .expect(200);
    expect(listed.body.length).toBe(1);
    expect(listed.body[0].status).toBe('published');
    expect(listed.body[0].credentialRef).toBeUndefined();
  }, 60000);

  it('실패→재시도: fail- 채널 → publish_failed → 채널 교정 후 retry → published', async () => {
    if (!ready()) {
      console.warn('[dist-e2e] 인프라 미가용 — 실패/재시도 테스트 skip');
      return;
    }
    // fail- 접두 채널(결정적 실패) — jeju-si 소유
    const failChannelId = uuidv7();
    await prisma!.channelAccount.create({
      data: {
        id: failChannelId,
        platform: 'kakao',
        stationId: jejuId,
        name: '제주시 실패채널(테스트)',
        externalChannelId: 'fail-jeju-e2e',
        credentialRef: 'kakao:jeju-fail',
        capabilities: ['vod_publish'],
        status: 'connected',
      },
    });
    const contentId = await seedApprovedContent(jejuId, [failChannelId]);

    await http()
      .post(`/v1/contents/${contentId}/distribute`)
      .set(auth(adminToken))
      .send({})
      .expect(200);

    const failStatus = await pollContentStatus(contentId, ['published', 'publish_failed']);
    expect(failStatus).toBe('publish_failed');
    const failedPub = (await prisma!.publication.findFirst({ where: { contentId } }))!;
    expect(failedPub.status).toBe('failed');

    // 채널 교정(fail- → ok-) 후 채널 단위 재시도
    await prisma!.channelAccount.update({
      where: { id: failChannelId },
      data: { externalChannelId: 'ok-jeju-e2e' },
    });
    const retry = await http()
      .post(`/v1/publications/${failedPub.id}/retry`)
      .set(auth(adminToken))
      .send({})
      .expect(200);
    expect(retry.body.status).toBe('queued');

    const okStatus = await pollContentStatus(contentId, ['published', 'publish_failed']);
    expect(okStatus).toBe('published');
    const okPub = (await prisma!.publication.findUnique({ where: { id: failedPub.id } }))!;
    expect(okPub.status).toBe('published');
    expect(okPub.externalUrl).toContain('ok-jeju-e2e');
  }, 60000);

  it('reporter_only: 기자 승인 → 자동 송출 → Publication published & content published', async () => {
    if (!ready()) {
      console.warn('[dist-e2e] 인프라 미가용 — reporter_only 자동송출 테스트 skip');
      return;
    }
    const contentId = await seedReporterReviewContent(aewolId); // 애월 기본 kakao 채널(시드됨)

    // 기자 승인 — reviewPolicy=reporter_only → reporter_approved→publishing 자동 연쇄 →
    // 컨트롤러가 status=publishing 감지해 자동 송출(distribute 미경유). 센터 개입 없음.
    const res = await http()
      .post(`/v1/contents/${contentId}/approve`)
      .set(auth(reporterToken))
      .expect(200);
    expect(res.body.status).toBe('publishing');

    const status = await pollContentStatus(contentId, ['published', 'publish_failed']);
    expect(status).toBe('published');

    const pubs = await prisma!.publication.findMany({ where: { contentId } });
    expect(pubs.length).toBe(1);
    const pub = pubs[0]!;
    expect(pub.status).toBe('published');
    // 담당 기자 액터로 자동 송출됨(센터 아님)
    expect(pub.requestedByUserId).toBe(reporterId);
    expect(pub.externalPostId).toBe(`kakao_mock_${pub.id}`);

    // 자동 연쇄 + 송출 완료 홉이 로그에 존재
    const logs = await prisma!.statusTransitionLog.findMany({ where: { entityId: contentId } });
    const hops = new Set(logs.map((l) => `${l.fromStatus}->${l.toStatus}`));
    expect(hops.has('reporter_approved->publishing')).toBe(true);
    expect(hops.has('publishing->published')).toBe(true);
  }, 60000);
});
