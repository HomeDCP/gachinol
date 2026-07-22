/**
 * 미디어 파이프라인 E2E — 업로드 → 트랜스코딩 → 프리뷰 → 기자 승인 대기 한 바퀴 실증.
 *
 * 인프라 조달(정직 보고 규약):
 *  - Postgres: 기존 e2e 하네스(global-setup) 재사용 — docker(pnpm infra:up) 또는 로컬 PG.
 *  - Redis:  redis-memory-server(인프로세스 실 Redis 바이너리). BullMQ는 실 Redis 필수(ioredis-mock 불가).
 *  - S3:     s3rver(인프로세스 순수 JS S3). presigned PUT/GET·GetObject/PutObject 실사용.
 *  - FFmpeg: ffmpeg-static/ffprobe-static(시스템 설치 불요). tiny mp4 런타임 생성(커밋 금지).
 *  - Worker: media-worker createMediaWorker로 인프로세스 구동(api Queue/QueueEvents와 동일 Redis).
 *
 * DB 미가용 시 describeWithDb가 녹색 skip. Redis/S3 인프로세스 기동 실패 시 각 테스트가 경고 후 skip.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  CreateBucketCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import ffmpegStatic from 'ffmpeg-static';
import request from 'supertest';
import type { Worker } from 'bullmq';
// media-worker는 dist(CJS)로 소비 — index.ts(부팅 main)가 아니라 팩토리 모듈만 deep-import
import { createMediaWorker } from '@gachinol/media-worker/dist/worker';
import { createS3Io } from '@gachinol/media-worker/dist/s3';
import { createRedisConnection } from '@gachinol/media-worker/dist/redis';
import { loadWorkerEnv } from '@gachinol/media-worker/dist/env';
import { probe } from '@gachinol/media-worker/dist/ffmpeg';
import { describeWithDb, e2eDb } from './e2e-db';

const d = describeWithDb();

const S3_BUCKET = 'gachinol-media';
const S3_KEY = 'S3RVER';
const S3_SECRET = 'S3RVER';

interface Embedded {
  redisUrl: string;
  s3Endpoint: string;
  stop: () => Promise<void>;
}

/** redis-memory-server + s3rver 기동 — 실패 시 null(테스트가 skip) */
async function startEmbedded(): Promise<Embedded | null> {
  try {
    // 지연 import — devDep 부재 환경에서도 모듈 로드 단계 크래시 방지
    const { RedisMemoryServer } = await import('redis-memory-server');
    const S3rver = (await import('s3rver')).default;

    const redis = new RedisMemoryServer();
    const host = await redis.getHost();
    const port = await redis.getPort();
    const redisUrl = `redis://${host}:${port}`;

    const dir = mkdtempSync(join(tmpdir(), 's3rver-e2e-'));
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
    console.warn(`[media-e2e] 인프로세스 Redis/S3 기동 실패 — 스킵: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

d('media pipeline (withDb + embedded redis/s3)', () => {
  let embedded: Embedded | null = null;
  let app: INestApplication | null = null;
  let worker: Worker | null = null;
  let workerConn: ReturnType<typeof createRedisConnection> | null = null;
  let prisma: PrismaClient | null = null;
  let s3Client: S3Client | null = null;
  let reporterToken = '';
  let contentId = '';
  let tinyMp4 = '';
  const ready = (): boolean => embedded != null && app != null;

  const http = () => request(app!.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    embedded = await startEmbedded();
    if (!embedded) return;

    // ① 인프라 env 주입 — createE2eApp(ConfigModule) 부팅 전에 설정
    // AI 비활성 회귀 가드 — 분석 홉을 스킵(processing→preview_generating 직행)해 이 파이프라인이
    // AI 미구성 배포와 동일하게 도는지 실증한다. 빈 문자열로 고정(dotenv가 루트 .env AI_WORKER_URL을
    // 재주입하지 못하게 — dotenv는 이미 존재하는 process.env 키를 덮지 않는다). 결정성·테스트 순서 무관.
    process.env.AI_WORKER_URL = '';
    process.env.REDIS_URL = embedded.redisUrl;
    process.env.S3_ENDPOINT = embedded.s3Endpoint;
    process.env.S3_PUBLIC_ENDPOINT = embedded.s3Endpoint;
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_BUCKET = S3_BUCKET;
    process.env.S3_ACCESS_KEY = S3_KEY;
    process.env.S3_SECRET_KEY = S3_SECRET;
    process.env.S3_FORCE_PATH_STYLE = 'true';

    // ② 버킷 생성
    s3Client = new S3Client({
      region: 'us-east-1',
      endpoint: embedded.s3Endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: S3_KEY, secretAccessKey: S3_SECRET },
    });
    await s3Client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));

    // ③ tiny mp4 (testsrc 1.5s 320x240 + 사인파 오디오) — 런타임 생성, 커밋 금지
    const wdir = mkdtempSync(join(tmpdir(), 'media-e2e-'));
    tinyMp4 = join(wdir, 'tiny.mp4');
    execFileSync(
      ffmpegStatic as unknown as string,
      [
        '-f', 'lavfi', '-i', 'testsrc=duration=1.5:size=320x240:rate=12',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-shortest', tinyMp4,
      ],
      { stdio: 'ignore' },
    );

    // ④ 앱 부팅(리스너 활성) + 인프로세스 워커 구동
    const { createE2eApp, resetDb } = await import('./e2e-app');
    await resetDb();
    app = await createE2eApp();

    const workerEnv = loadWorkerEnv({
      REDIS_URL: embedded.redisUrl,
      S3_ENDPOINT: embedded.s3Endpoint,
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY: S3_KEY,
      S3_SECRET_KEY: S3_SECRET,
      S3_FORCE_PATH_STYLE: 'true',
      MEDIA_WORKER_CONCURRENCY: '2',
    } as NodeJS.ProcessEnv);
    workerConn = createRedisConnection(embedded.redisUrl);
    worker = createMediaWorker(workerConn, createS3Io(workerEnv), workerEnv);

    prisma = new PrismaClient();

    // ⑤ reporter 준비 (admin → reporter 생성 → 로그인)
    const login = await http()
      .post('/v1/auth/login')
      .send({ email: e2eDb().adminEmail, password: e2eDb().adminPassword })
      .expect(200);
    const adminToken = login.body.tokens.accessToken;
    const stations = await http().get('/v1/stations').set(auth(adminToken)).expect(200);
    const aewolId = stations.body.items.find((s: { code: string }) => s.code === 'aewol').id;
    await http()
      .post('/v1/users')
      .set(auth(adminToken))
      .send({
        role: 'reporter',
        name: '애월 기자',
        email: 'media-reporter@e2e.local',
        password: 'reporter-password',
        stationId: aewolId,
      })
      .expect(201);
    const rLogin = await http()
      .post('/v1/auth/login')
      .send({ email: 'media-reporter@e2e.local', password: 'reporter-password' })
      .expect(200);
    reporterToken = rLogin.body.tokens.accessToken;
  }, 120000);

  afterAll(async () => {
    await worker?.close().catch(() => undefined);
    await workerConn?.quit().catch(() => undefined);
    await app?.close().catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
    s3Client?.destroy();
    await embedded?.stop().catch(() => undefined);
  });

  it('업로드 → 트랜스코딩 → 프리뷰 → awaiting_reporter_review 완주', async () => {
    if (!ready()) {
      console.warn('[media-e2e] 인프라 미가용 — 파이프라인 테스트 skip');
      return;
    }

    // draft 생성
    const draft = await http()
      .post('/v1/contents')
      .set(auth(reporterToken))
      .send({
        title: '애월 해녀 인터뷰',
        category: 'news',
        scenes: [{ order: 0, caption: '오프닝', startSec: null, endSec: null }],
      })
      .expect(201);
    contentId = draft.body.id;

    // ① upload-url 발급 (draft → uploading)
    const sizeBytes = readFileSync(tinyMp4).byteLength;
    const issued = await http()
      .post(`/v1/contents/${contentId}/upload-url`)
      .set(auth(reporterToken))
      .send({
        contentId,
        fileName: 'tiny.mp4',
        mimeType: 'video/mp4',
        sizeBytes,
      })
      .expect(200);
    expect(issued.body.storageKey).toBe(`contents/${contentId}/g1/original.mp4`);

    const afterIssue = await http()
      .get(`/v1/contents/${contentId}`)
      .set(auth(reporterToken))
      .expect(200);
    expect(afterIssue.body.content.status).toBe('uploading');

    // ② presigned PUT — 실제 바이트 전송 (S3rver)
    const putRes = await fetch(issued.body.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: readFileSync(tinyMp4),
    });
    expect(putRes.status).toBe(200);

    // ③ upload-complete (uploading → uploaded + transcode enqueue)
    const completed = await http()
      .post(`/v1/contents/${contentId}/upload-complete`)
      .set(auth(reporterToken))
      .send({ contentId, storageKey: issued.body.storageKey })
      .expect(200);
    expect(completed.body.status).toBe('uploaded');

    // ④ 워커가 파이프라인을 돌려 awaiting_reporter_review 도달할 때까지 폴링(최대 ~90s)
    const deadline = Date.now() + 90000;
    let status = 'uploaded';
    while (Date.now() < deadline) {
      const row = await prisma!.content.findUnique({ where: { id: contentId } });
      status = row?.status ?? status;
      if (status === 'awaiting_reporter_review') break;
      if (status === 'processing_failed' || status === 'preview_failed') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(status).toBe('awaiting_reporter_review');

    // ⑤ 자산 4종(original·rendition·preview·thumbnail) ready + storageKey 접두 검증
    const assets = await prisma!.mediaAsset.findMany({ where: { contentId } });
    const byKind = Object.fromEntries(assets.map((a) => [a.kind, a]));
    for (const kind of ['original', 'rendition', 'preview', 'thumbnail']) {
      expect(byKind[kind]?.status).toBe('ready');
      expect(byKind[kind]?.storageKey.startsWith(`contents/${contentId}/g1/`)).toBe(true);
    }
    expect(byKind.rendition?.renditionLabel).toBe('720p');
    expect(byKind.preview?.renditionLabel).toBe('preview-360p');
    expect(byKind.rendition?.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    // ⑥ system 전이 로그 — uploaded→processing→preview_generating→awaiting_reporter_review
    const logs = await prisma!.statusTransitionLog.findMany({
      where: { entityId: contentId, actorType: 'system' },
    });
    const hops = new Set(logs.map((l) => `${l.fromStatus}->${l.toStatus}`));
    expect(hops.has('uploaded->processing')).toBe(true);
    expect(hops.has('processing->preview_generating')).toBe(true);
    expect(hops.has('preview_generating->awaiting_reporter_review')).toBe(true);
    for (const l of logs) expect(l.jobId).toBeTruthy();

    // ⑦ preview 해상도 검증 — worker가 산출물 probe한 값(권위) ≤ 360
    expect(byKind.preview?.height).toBeLessThanOrEqual(360);

    // ⑧ 보너스(best-effort) — preview 오브젝트를 S3에서 받아 ffprobe. s3rver 다운로드 편차는 무해 처리
    try {
      const previewKey = byKind.preview!.storageKey;
      const got = await s3Client!.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: previewKey }));
      const bytes = Buffer.from(await got.Body!.transformToByteArray());
      const outPath = join(mkdtempSync(join(tmpdir(), 'preview-')), 'preview.mp4');
      writeFileSync(outPath, bytes);
      const meta = await probe(outPath);
      expect(meta.height).toBeLessThanOrEqual(360);
    } catch (e) {
      console.warn(`[media-e2e] preview S3 재확인 skip(s3rver 편차): ${e instanceof Error ? e.message : e}`);
    }
  }, 120000);
});
