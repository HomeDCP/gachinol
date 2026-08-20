import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaJobData } from '@gachinol/shared';
import ffmpegPath from 'ffmpeg-static';
import type { Job } from 'bullmq';
import { loadWorkerEnv, type WorkerEnv } from '../env';
import { probe, transcode } from '../ffmpeg';
import { fileSize } from '../s3';
import type { S3Io } from '../s3';
import { processAutoEdit } from './auto-edit';
import { processPreview } from './preview';
import { processThumbnail } from './thumbnail';
import { processTranscode } from './transcode';

/**
 * 프로세서 통합 테스트 — 실 FFmpeg(ffmpeg-static) + 로컬-FS S3 스텁(Redis·실 S3 불요).
 * tiny mp4는 런타임 생성(testsrc 1s 320x240) — 커밋 금지.
 */

const env: WorkerEnv = loadWorkerEnv({
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'a',
  S3_SECRET_KEY: 'b',
} as NodeJS.ProcessEnv);

/** 로컬 디렉토리를 버킷처럼 쓰는 S3Io 스텁 — download는 seed 맵, upload는 outDir에 기록 */
function localS3(seed: Record<string, string>, outDir: string): { io: S3Io; uploaded: string[] } {
  const uploaded: string[] = [];
  const io: S3Io = {
    async download(_bucket, key, destPath) {
      const src = seed[key];
      if (!src) throw new Error(`seed 없음: ${key}`);
      await copyFile(src, destPath);
    },
    async upload(_bucket, key, srcPath) {
      const dest = join(outDir, key.replace(/[^a-zA-Z0-9._-]/g, '_'));
      await copyFile(srcPath, dest);
      uploaded.push(key);
    },
  };
  return { io, uploaded };
}

function fakeJob<T extends MediaJobData>(
  name: string,
  data: T,
): { job: Job<MediaJobData>; progress: number[] } {
  const progress: number[] = [];
  const job = {
    id: `${name}:c1:g1`,
    name,
    data,
    updateProgress: (p: unknown) => {
      progress.push(Number(p));
      return Promise.resolve();
    },
  } as unknown as Job<MediaJobData>;
  return { job, progress };
}

let workDir: string;
let tinyMp4: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'gachinol-proc-test-'));
  tinyMp4 = join(workDir, 'tiny.mp4');
  if (!ffmpegPath) throw new Error('ffmpeg-static 경로 없음');
  execFileSync(
    ffmpegPath,
    [
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=320x240:rate=10',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-shortest',
      tinyMp4,
    ],
    { stdio: 'ignore' },
  );
}, 60000);

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

const source = { bucket: 'gachinol-media', key: 'contents/c1/g1/original.mp4' };
const outputBucket = 'gachinol-media';
const outputKeyPrefix = 'contents/c1/g1/';

describe('processTranscode', () => {
  test('720p rendition 산출 — 계약 준수(kind·key·checksum·probe)', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'out-'));
    const { io, uploaded } = localS3({ [source.key]: tinyMp4 }, outDir);
    const { job, progress } = fakeJob('transcode', {
      type: 'transcode',
      payload: { contentId: 'c1' as never, sourceAssetId: 'a1' as never, renditionLabels: ['720p'] },
      generation: 1,
      source,
      outputBucket,
      outputKeyPrefix,
    } satisfies MediaJobData<'transcode'>);

    const result = await processTranscode(job, io, env);
    expect(result.assets).toHaveLength(1);
    const asset = result.assets[0]!;
    expect(asset.kind).toBe('rendition');
    expect(asset.renditionLabel).toBe('720p');
    expect(asset.storageKey).toBe('contents/c1/g1/rendition/720p.mp4');
    expect(asset.mimeType).toBe('video/mp4');
    expect(asset.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(asset.sizeBytes).toBeGreaterThan(0);
    // 원본 240p → 업스케일 방지(720 이하)
    expect(asset.height).toBeLessThanOrEqual(720);
    expect(asset.videoCodec).toBe('h264');
    expect(uploaded).toEqual(['contents/c1/g1/rendition/720p.mp4']);
    expect(progress.at(-1)).toBe(100);
    await rm(outDir, { recursive: true, force: true });
  });
});

describe('processPreview', () => {
  test('360p preview 산출 — height ≤ 360', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'out-'));
    const { io } = localS3({ [source.key]: tinyMp4 }, outDir);
    const { job } = fakeJob('preview', {
      type: 'preview',
      payload: {
        contentId: 'c1' as never,
        sourceAssetId: 'a1' as never,
        maxHeight: 360,
        maxBitrateKbps: 600,
      },
      generation: 1,
      source,
      outputBucket,
      outputKeyPrefix,
    } satisfies MediaJobData<'preview'>);

    const result = await processPreview(job, io, env);
    expect(result.asset.kind).toBe('preview');
    expect(result.asset.storageKey).toBe('contents/c1/g1/preview.mp4');
    expect(result.asset.renditionLabel).toBe('preview-360p');
    expect(result.asset.height).toBeLessThanOrEqual(360);
    expect(result.asset.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    await rm(outDir, { recursive: true, force: true });
  });
});

describe('processThumbnail', () => {
  test('JPEG 썸네일 산출 — 이미지 kind·mime', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'out-'));
    const { io } = localS3({ [source.key]: tinyMp4 }, outDir);
    const { job } = fakeJob('thumbnail', {
      type: 'thumbnail',
      payload: { contentId: 'c1' as never, sourceAssetId: 'a1' as never },
      generation: 1,
      source,
      outputBucket,
      outputKeyPrefix,
    } satisfies MediaJobData<'thumbnail'>);

    const result = await processThumbnail(job, io, env);
    expect(result.asset.kind).toBe('thumbnail');
    expect(result.asset.mimeType).toBe('image/jpeg');
    expect(result.asset.storageKey).toBe('contents/c1/g1/thumbnail.jpg');
    expect(result.asset.sizeBytes).toBeGreaterThan(0);
    expect(result.asset.durationSec).toBeUndefined();
    const files = await readdir(outDir);
    expect(files).toHaveLength(1);
    await rm(outDir, { recursive: true, force: true });
  });
});

describe('ffmpeg 워치독', () => {
  test('무진행 타임아웃 초과 시 SIGKILL 후 reject(hang 방어)', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'wd-'));
    const output = join(outDir, 'out.mp4');
    // timeoutMs=1 → spawn 지연 사이에 워치독이 먼저 발화해 강제 종료·reject
    await expect(
      transcode(tinyMp4, output, { height: 720, vbrKbps: 2500, timeoutMs: 1 }),
    ).rejects.toThrow(/워치독 타임아웃/);
    await rm(outDir, { recursive: true, force: true });
  });
});

describe('probe (ffprobe-static)', () => {
  test('생성된 tiny mp4 메타 추출', async () => {
    expect(existsSync(tinyMp4)).toBe(true);
    expect(await fileSize(tinyMp4)).toBeGreaterThan(0);
    const meta = await probe(tinyMp4);
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);
    expect(meta.videoCodec).toBeDefined();
  });
});

describe('processAutoEdit', () => {
  test('컷 없음(Phase 1 실경로) — edited_master + rendition 2건, 타임라인 항등', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'out-'));
    const { io, uploaded } = localS3({ [source.key]: tinyMp4 }, outDir);
    const { job, progress } = fakeJob('auto_edit', {
      type: 'auto_edit',
      payload: {
        contentId: 'c1' as never,
        sourceAssetId: 'a1' as never,
        revisionRequestId: null,
        reanalyze: false,
        editPlan: null,
      },
      generation: 1,
      source,
      outputBucket,
      outputKeyPrefix,
    } satisfies MediaJobData<'auto_edit'>);

    const result = await processAutoEdit(job, io, env);

    expect(result.assets.map((a) => a.kind).sort()).toEqual(['edited_master', 'rendition']);
    expect(uploaded).toEqual([
      'contents/c1/g1/edited-master.mp4',
      'contents/c1/g1/rendition/720p.mp4',
    ]);
    for (const a of result.assets) {
      expect(a.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.sizeBytes).toBeGreaterThan(0);
      expect(a.videoCodec).toBe('h264');
    }
    // ★ 타임라인 항등 — 이게 깨지면 구독자 자막이 밀린다
    expect(result.timeline).toHaveLength(1);
    const [m] = result.timeline;
    expect(m.sourceStartSec).toBe(m.outputStartSec);
    expect(Math.abs(m.sourceEndSec - m.outputEndSec)).toBeLessThan(0.05);
    expect(progress.at(-1)).toBe(100);
    await rm(outDir, { recursive: true, force: true });
  }, 60000);

  test('컷 있음 — segments 순서대로 이어붙이고 타임라인이 누적 오프셋을 담는다', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'out-'));
    const { io } = localS3({ [source.key]: tinyMp4 }, outDir);
    const { job } = fakeJob('auto_edit', {
      type: 'auto_edit',
      payload: {
        contentId: 'c1' as never,
        sourceAssetId: 'a1' as never,
        revisionRequestId: null,
        reanalyze: false,
        editPlan: {
          segments: [
            { startSec: 0, endSec: 0.4 },
            { startSec: 0.6, endSec: 1.0 },
          ],
        },
      },
      generation: 2,
      source,
      outputBucket,
      outputKeyPrefix: 'contents/c1/g2/',
    } satisfies MediaJobData<'auto_edit'>);

    const result = await processAutoEdit(job, io, env);

    expect(result.timeline).toEqual([
      { sourceStartSec: 0, sourceEndSec: 0.4, outputStartSec: 0, outputEndSec: 0.4 },
      { sourceStartSec: 0.6, sourceEndSec: 1.0, outputStartSec: 0.4, outputEndSec: 0.8 },
    ]);
    const master = result.assets.find((a) => a.kind === 'edited_master')!;
    expect(master.durationSec).toBeLessThan(1); // 컷으로 짧아졌다
    await rm(outDir, { recursive: true, force: true });
  }, 60000);
});
