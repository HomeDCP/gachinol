/**
 * AI 분석 파이프라인 E2E — 업로드 → 트랜스코딩 → **analyzing(분석)** → 프리뷰 → 기자 승인 대기 한 바퀴 실증.
 *
 * media-pipeline.e2e-spec.ts는 AI 비활성(AI_WORKER_URL 미설정) 회귀 가드로 무수정 보존한다.
 * 이 파일은 AI 활성 경로를 새로 검증한다(LOCKED H: 신규 파일).
 *
 * 인프라 조달(정직 보고 규약):
 *  - Postgres: 기존 e2e 하네스(global-setup) 재사용.
 *  - Redis:  redis-memory-server(인프로세스 실 Redis). BullMQ 실 Redis 필수.
 *  - S3:     s3rver(인프로세스 순수 JS S3).
 *  - FFmpeg: ffmpeg-static. tiny mp4 런타임 생성(커밋 금지).
 *  - media-worker: createMediaWorker 인프로세스 구동.
 *  - ai-worker: **인프로세스 node:http 스텁**(POST /analyze→결정적 AnalyzeResponse, GET /health).
 *               실 uvicorn/docker 불요 — api Analysis 워커·QueueEvents가 실 HTTP 왕복을 돈다.
 *               (계약 동형 스텁이며 실 파이썬 ai-worker는 이 프로세스에 띄우지 않는다.)
 *
 * ★ AI_WORKER_URL은 createE2eApp 이전에 스텁 주소로 설정하고, afterAll에서 반드시 삭제한다
 *   (maxWorkers=1 공유 프로세스 — 뒤이어 도는 media-pipeline 회귀 가드가 AI 비활성이어야 함).
 */
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import ffmpegStatic from 'ffmpeg-static';
import request from 'supertest';
import type { Worker } from 'bullmq';
import { createMediaWorker } from '@gachinol/media-worker/dist/worker';
import { createS3Io } from '@gachinol/media-worker/dist/s3';
import { createRedisConnection } from '@gachinol/media-worker/dist/redis';
import { loadWorkerEnv } from '@gachinol/media-worker/dist/env';
import { describeWithDb, e2eDb } from './e2e-db';

const d = describeWithDb();

const S3_BUCKET = 'gachinol-media';
// ★ E2E_S3_ENDPOINT/E2E_REDIS_URL 주입 지원(media-pipeline.e2e-spec.ts와 동형, 대장 #167) —
// s3rver는 aws-chunked 스트림 업로드를 디코드하지 못해 파일을 손상시키고, auto_edit이 만든
// edited_master를 preview가 다시 읽으면서 이 스펙은 embedded 경로에서 구조적으로 preview_failed가
// 된다(선존 — T-W2-36 검증 중 발견). MinIO 주입 시 같은 왕복이 바이트 일치한다.
const S3_KEY = process.env.E2E_S3_KEY ?? 'S3RVER';
const S3_SECRET = process.env.E2E_S3_SECRET ?? 'S3RVER';

interface Embedded {
  redisUrl: string;
  s3Endpoint: string;
  stop: () => Promise<void>;
}

/** 스텁 ai-worker가 반환할 결정적 AnalyzeResponse (vision·text non-null) */
const stubAnalyzeResponse = (languageHint: unknown) => ({
  vision: {
    shots: [{ startSec: 0, endSec: 1.5, label: '바다' }],
    labels: ['바다', '마을'],
    thumbnailCandidatesSec: [0.15, 0.75, 1.35],
    safetyFlags: [],
  },
  text: {
    transcript: [{ startSec: 0, endSec: 1.5, text: '장면 1', confidence: 0.9 }],
    summary: '약 1.5초 분량의 영상입니다.',
    keywords: ['바다', '해녀'],
    tags: ['바다', '마을'],
    language: typeof languageHint === 'string' ? languageHint : 'ko',
  },
  recommendationScore: 0.5,
  modelInfo: { visionModel: 'stub-e2e-vision', sttModel: 'stub-e2e-stt', version: '0.1.0' },
});

interface StubAiWorker {
  url: string;
  /** 마지막으로 수신한 /analyze 요청 본문(파싱) — durationSec 전달 검증용 */
  lastAnalyzeRequest: () => Record<string, unknown> | null;
  close: () => Promise<void>;
}

/** 인프로세스 스텁 ai-worker — 실 HTTP 왕복(api Analysis 워커 → 여기). */
async function startStubAiWorker(): Promise<StubAiWorker> {
  let lastReq: Record<string, unknown> | null = null;
  const server: Server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', provider: 'stub-e2e' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/analyze') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let languageHint: unknown = 'ko';
        try {
          const parsed = JSON.parse(body || '{}') as Record<string, unknown>;
          lastReq = parsed;
          languageHint = parsed.languageHint;
        } catch {
          /* 무해 — 기본 ko */
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(stubAnalyzeResponse(languageHint)));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    lastAnalyzeRequest: () => lastReq,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function startEmbedded(): Promise<Embedded | null> {
  try {
    let redisUrl = process.env.E2E_REDIS_URL;
    let stopRedis: () => Promise<void> = async () => undefined;
    if (!redisUrl) {
      const { RedisMemoryServer } = await import('redis-memory-server');
      const redis = new RedisMemoryServer();
      const host = await redis.getHost();
      const port = await redis.getPort();
      redisUrl = `redis://${host}:${port}`;
      stopRedis = async () => void (await redis.stop().catch(() => undefined));
    }

    const external = process.env.E2E_S3_ENDPOINT;
    if (external) {
      return { redisUrl, s3Endpoint: external, stop: stopRedis };
    }

    const S3rver = (await import('s3rver')).default;
    const dir = mkdtempSync(join(tmpdir(), 's3rver-ai-e2e-'));
    const s3port = 9700 + Math.floor(Math.random() * 100);
    const s3 = new S3rver({ port: s3port, address: '127.0.0.1', silent: true, directory: dir });
    await s3.run();
    const s3Endpoint = `http://127.0.0.1:${s3port}`;

    return {
      redisUrl,
      s3Endpoint,
      stop: async () => {
        await s3.close().catch(() => undefined);
        await stopRedis();
      },
    };
  } catch (e) {
    console.warn(`[ai-e2e] 인프로세스 Redis/S3 기동 실패 — 스킵: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

d('analysis pipeline (withDb + embedded redis/s3 + stub ai-worker)', () => {
  let embedded: Embedded | null = null;
  let stub: StubAiWorker | null = null;
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

    // ① 스텁 ai-worker 기동 + AI_WORKER_URL 설정 (createE2eApp 이전!)
    stub = await startStubAiWorker();
    process.env.AI_WORKER_URL = stub.url;

    // ② 인프라 env 주입
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
    // 외부 저장소(MinIO)는 버킷이 이미 있을 수 있다 — 중복 생성은 무해 무시 (media-pipeline 동형)
    await s3Client.send(new CreateBucketCommand({ Bucket: S3_BUCKET })).catch(() => undefined);

    // ③ tiny mp4
    const wdir = mkdtempSync(join(tmpdir(), 'ai-e2e-'));
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

    // ④ 앱 부팅(media·analysis 리스너 활성) + 인프로세스 media-worker 구동
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

    // ⑤ reporter 준비
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
        email: 'ai-reporter@e2e.local',
        password: 'reporter-password',
        stationId: aewolId,
      })
      .expect(201);
    const rLogin = await http()
      .post('/v1/auth/login')
      .send({ email: 'ai-reporter@e2e.local', password: 'reporter-password' })
      .expect(200);
    reporterToken = rLogin.body.tokens.accessToken;
  }, 120000);

  afterAll(async () => {
    await worker?.close().catch(() => undefined);
    await workerConn?.quit().catch(() => undefined);
    await app?.close().catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
    s3Client?.destroy();
    await stub?.close().catch(() => undefined);
    await embedded?.stop().catch(() => undefined);
    // ★ AI_WORKER_URL 정리 — 뒤이어 도는 media-pipeline 회귀 가드가 AI 비활성이어야 함
    delete process.env.AI_WORKER_URL;
  });

  it('업로드 → 트랜스코딩 → analyzing → 프리뷰 → awaiting_reporter_review + ai_analyses 기록', async () => {
    if (!ready()) {
      console.warn('[ai-e2e] 인프라 미가용 — 분석 파이프라인 테스트 skip');
      return;
    }

    const draft = await http()
      .post('/v1/contents')
      .set(auth(reporterToken))
      .send({
        title: '애월 해녀 인터뷰(분석)',
        category: 'news',
        scenes: [{ order: 0, caption: '오프닝', startSec: null, endSec: null }],
      })
      .expect(201);
    contentId = draft.body.id;

    const sizeBytes = readFileSync(tinyMp4).byteLength;
    const issued = await http()
      .post(`/v1/contents/${contentId}/upload-url`)
      .set(auth(reporterToken))
      .send({ contentId, fileName: 'tiny.mp4', mimeType: 'video/mp4', sizeBytes })
      .expect(200);

    const putRes = await fetch(issued.body.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: readFileSync(tinyMp4),
    });
    expect(putRes.status).toBe(200);

    await http()
      .post(`/v1/contents/${contentId}/upload-complete`)
      .set(auth(reporterToken))
      .send({ contentId, storageKey: issued.body.storageKey })
      .expect(200);

    // 파이프라인 완주 폴링(최대 ~90s)
    const deadline = Date.now() + 90000;
    let status = 'uploaded';
    while (Date.now() < deadline) {
      const row = await prisma!.content.findUnique({ where: { id: contentId } });
      status = row?.status ?? status;
      if (status === 'awaiting_reporter_review') break;
      if (['processing_failed', 'analysis_failed', 'preview_failed'].includes(status)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(status).toBe('awaiting_reporter_review');

    // 시스템 전이 로그 — analyzing 홉 존재 (processing->analyzing AND analyzing->preview_generating)
    const logs = await prisma!.statusTransitionLog.findMany({
      where: { entityId: contentId, actorType: 'system' },
    });
    const hops = new Set(logs.map((l) => `${l.fromStatus}->${l.toStatus}`));
    expect(hops.has('uploaded->processing')).toBe(true);
    expect(hops.has('processing->analyzing')).toBe(true);
    expect(hops.has('analyzing->preview_generating')).toBe(true);
    expect(hops.has('preview_generating->awaiting_reporter_review')).toBe(true);
    // AI 활성 경로이므로 직행(processing->preview_generating)은 없어야 함
    expect(hops.has('processing->preview_generating')).toBe(false);

    // api가 /analyze에 트랜스코딩 실측 재생시간을 전달했는지 검증(스텁 퇴화 분석 방지 회귀 가드).
    // durationSec 미전달 시 실 파이썬 스텁은 '약 0초·단일 [0,0] 샷'으로 떨어진다.
    const analyzeReq = stub!.lastAnalyzeRequest();
    expect(analyzeReq).toBeTruthy();
    const media = analyzeReq?.media as { durationSec?: number } | undefined;
    expect(typeof media?.durationSec).toBe('number');
    expect(media!.durationSec).toBeGreaterThan(0);

    // ai_analyses 1행 (contentId, g1) — vision·text non-null
    const analyses = await prisma!.aiAnalysis.findMany({ where: { contentId } });
    expect(analyses.length).toBe(1);
    const analysis = analyses[0]!;
    expect(analysis.generation).toBe(1);
    expect(analysis.vision).toBeTruthy();
    expect(analysis.text).toBeTruthy();
    expect(analysis.createdByJobId).toBe(`analysis:${contentId}:g1`);
    expect(analysis.completedAt).toBeTruthy();

    // 상세 DTO에 analysis 노출 확인
    const detail = await http()
      .get(`/v1/contents/${contentId}`)
      .set(auth(reporterToken))
      .expect(200);
    expect(detail.body.analysis).toBeTruthy();
    expect(detail.body.analysis.vision.labels).toContain('바다');
    expect(detail.body.analysis.modelInfo.version).toBe('0.1.0');
  }, 120000);
});
