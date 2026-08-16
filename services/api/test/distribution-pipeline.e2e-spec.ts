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
 *
 * T-W2-10 보강1(qa-verifier): archived 훅 배선(`ContentWorkflowService.transition()`의
 * `if (to === 'archived') …`) 커버 전용 테스트 1건을 이 파일에 추가한다. 그 훅을 유닛 스위트에서
 * published→archived로 직접 밟으면 `packages/shared/src/content/not-wired.ts`의 계측이 그 엣지를
 * "관측됨"으로 표시해 wiring 레지스트리와 불일치가 난다(계측은 `NODE_ENV==='test' &&
 * GACHINOL_WIRING_PROBE_DIR` 이중 게이트이고, 후자는 api 단위 jest의 global-setup만 설정 —
 * `src/contents/transition-probe.ts` 참조). **e2e는 그 계측이 애초에 비활성**이라 이 엣지를 실제로
 * 밟아도 레지스트리에 영향이 없다 — 그래서 배선 커버는 유닛이 아니라 여기서 한다.
 * 이 파일이 이미 갖춘 embedded s3rver(실 오브젝트 바이트 기록 가능)를 재사용해 "공개 복사가
 * 진짜로 옮겨지고 진짜로 지워지는지"를 S3 HEAD로 직접 확인한다.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CreateBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { v7 as uuidv7 } from 'uuid';
import request from 'supertest';
import { CloudflareCacheService } from '../src/media/cloudflare-cache.service';
import { PUBLIC_MEDIA_CACHE_CONTROL } from '../src/media/public-media.service';
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
    // T-W2-10 보강1 — 공개 복사 게이트(보강2, MEDIA_PUBLIC_BASE_URL 미설정 시 no-op)를 이 스위트
    // 전체에서 열어 둔다. 값 자체가 실제로 도달 가능할 필요는 없다 — archived 훅 테스트는 구성된
    // 공개 HTTP URL을 fetch하지 않고 s3Client로 직접 s3rver 버킷을 확인한다.
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.e2e.test';

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
    delete process.env.MEDIA_PUBLIC_BASE_URL;
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

  it(
    'T-W2-10 보강1: published→archived 훅 배선 — 공개 렌디션이 실제로 복사됐다가 실제로 지워지고, ' +
      'CF 퍼지가 attempted:false로 관측된다(applyHop 경로 실주행, 뮤테이션 킬 대상)',
    async () => {
      if (!ready()) {
        console.warn('[dist-e2e] 인프라 미가용 — archived 훅 배선 테스트 skip');
        return;
      }
      const contentId = await seedApprovedContent(aewolId); // 애월 기본 kakao 채널(시드됨)
      const sourceKey = `contents/${contentId}/g1/rendition_720p.mp4`;
      const publicKey = `public/${sourceKey}`; // MEDIA_PUBLIC_PREFIX 기본값 'public'

      // 실 바이트를 s3rver에 기록 — copyObject가 옮길 실체가 있어야 "실제로 복사됐다"를 증명할 수 있다
      // (다른 테스트들의 rendition은 바이트가 없어 복사가 "키 없음"으로 실패 — 그건 무해하지만 이
      // 테스트의 목적과 다르다).
      await s3Client!.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: sourceKey,
          Body: Buffer.from('fake-mp4-bytes-for-e2e'),
        }),
      );

      // published까지 정상 송출 경로로 진행 — publishing→published 훅(applySystemTransition)이
      // 공개 복사를 실행한다(T-W2-10 syncPublishedCopies).
      await http()
        .post(`/v1/contents/${contentId}/distribute`)
        .set(auth(adminToken))
        .send({})
        .expect(200);
      const publishedStatus = await pollContentStatus(contentId, ['published', 'publish_failed']);
      expect(publishedStatus).toBe('published');

      // 공개 복사가 s3rver에 실제로 반영됐는지 — HEAD 성공(존재)해야 한다
      const copied = await s3Client!.send(
        new HeadObjectCommand({ Bucket: S3_BUCKET, Key: publicKey }),
      );
      expect(copied.ContentLength).toEqual(expect.any(Number));
      // T-W2-33 ⓑ — Cache-Control이 목적지 오브젝트에 실제로 실렸는가(MetadataDirective=REPLACE 필요),
      // 그리고 REPLACE로 ContentType이 날아가지 않았는가(날아가면 브라우저 재생이 깨진다).
      expect(copied.CacheControl).toBe(PUBLIC_MEDIA_CACHE_CONTROL);
      expect(copied.ContentType).toBe('video/mp4');

      // T-W2-33 ⓐ — 공개 사본 위치가 DB에 기록됐는가. 피드는 이 기록만 보고 공개 URL을 판정하므로
      // (S3 HEAD 0회) 기록이 없으면 CDN 서빙이 영영 안 켜지고 서명 URL로만 나간다.
      const afterPublish = (await prisma!.mediaAsset.findFirst({
        where: { contentId, kind: 'rendition', generation: 1 },
      }))!;
      expect(afterPublish.publicBucket).toBe(S3_BUCKET);
      expect(afterPublish.publicKey).toBe(publicKey);
      expect(afterPublish.publicCopiedAt).toBeInstanceOf(Date);

      // CF 퍼지 호출 결과를 관측 — pass-through 스파이(원 구현 그대로 호출, 반환값만 가로챈다)
      const cfCache = app!.get(CloudflareCacheService);
      let capturedPurgeResult: { attempted: boolean; success: boolean } | undefined;
      const originalPurge = cfCache.purge.bind(cfCache);
      jest.spyOn(cfCache, 'purge').mockImplementation(async (urls) => {
        const result = await originalPurge(urls);
        capturedPurgeResult = result;
        return result;
      });

      // archived로 전이 — content-workflow.service.ts의 `if (to === 'archived') …` 훅을 실제로 태운다.
      // 이 한 줄이 삭제되면(뮤테이션) 아래 두 단언(공개 객체 소멸·퍼지 attempted 관측)이 실패해야 한다.
      const archiveRes = await http()
        .post(`/v1/contents/${contentId}/transitions`)
        .set(auth(adminToken))
        .send({ toStatus: 'archived', note: 'T-W2-10 보강1 e2e' })
        .expect(200);
      expect(archiveRes.body.status).toBe('archived');

      // 공개 객체가 실제로 사라졌는지 — HEAD가 이제 실패(NotFound)해야 한다
      await expect(
        s3Client!.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: publicKey })),
      ).rejects.toBeDefined();

      // T-W2-33 ⓐ 대칭 — 기록도 함께 사라져야 한다. 이게 남으면 DB가 "공개 사본 있음"이라고
      // 거짓말하고 피드가 404 URL을 내준다(HEAD 판정보다 나쁜 상태 — 뮤테이션 킬 대상).
      const afterArchive = (await prisma!.mediaAsset.findFirst({
        where: { contentId, kind: 'rendition', generation: 1 },
      }))!;
      expect(afterArchive.publicBucket).toBeNull();
      expect(afterArchive.publicKey).toBeNull();
      expect(afterArchive.publicCopiedAt).toBeNull();

      // CF 퍼지 — env(CF_ZONE_ID/CF_API_TOKEN) 미설정이므로 attempted:false가 관측되면 충분
      // (실 Cloudflare 계정 불요 — "시도됐는가"만 확인, 조용한 no-op이 아니었음을 증명)
      expect(cfCache.purge).toHaveBeenCalled();
      expect(capturedPurgeResult).toEqual({
        attempted: false,
        success: false,
        reason: 'not_configured',
      });
    },
    60000,
  );
});
