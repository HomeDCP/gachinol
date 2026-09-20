import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaJobData } from '@gachinol/shared';
import ffmpegPath from 'ffmpeg-static';
import { path as ffprobePath } from 'ffprobe-static';
import type { Job } from 'bullmq';
import { loadWorkerEnv, type WorkerEnv } from '../env';
import { autoEdit, gopFromFps, probe, transcode } from '../ffmpeg';
import { fileSize } from '../s3';
import type { S3Io } from '../s3';
import { processAutoEdit } from './auto-edit';
import { processPreview } from './preview';
import { processThumbnail } from './thumbnail';
import { processTranscode } from './transcode';

/**
 * 프로세서 통합 테스트 — 실 FFmpeg(ffmpeg-static) + 로컬-FS S3 스텁(Redis·실 S3 불요).
 * 소스 mp4는 런타임 생성 — 커밋 금지.
 *
 * ★ 대장 #232 태스크① D1-a — 픽스처를 1920x1080으로 승격했다(舊: 320x240).
 * 모든 프로파일이 `scale=-2:'min(ih,H)'`를 쓰므로 240 높이 소스에는 720이든 1080이든 **항등**이라
 * 마스터를 1080으로 바꿔도 출력이 한 픽셀도 안 바뀌고, 누가 실수로 360으로 낮춰도 전부 초록이었다.
 * 480 높이 전용 `smallSourceMp4`는 업스케일 금지(D1-b④) 검증에만 쓴다.
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
/** 1920x1080 소스 — 마스터(1080 캡)·렌디션(720 캡) 양쪽 캡이 실제로 작동하는지 드러낸다 */
let tinyMp4: string;
/** 480p 소스 — 업스케일 금지(D1-b④) 전용. 마스터 캡(1080)보다 작아야 검증 의미가 있다 */
let smallSourceMp4: string;

function genTestVideo(dest: string, size: string): void {
  if (!ffmpegPath) throw new Error('ffmpeg-static 경로 없음');
  execFileSync(
    ffmpegPath,
    [
      '-f',
      'lavfi',
      '-i',
      `testsrc=duration=1:size=${size}:rate=10`,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-shortest',
      dest,
    ],
    { stdio: 'ignore' },
  );
}

/**
 * ffprobe로 비디오 프레임별 key_frame 플래그·pts(초)를 읽어 **실제 키프레임 위치**만 추출한다.
 * closed GOP(`-g`/`-keyint_min`/`-sc_threshold 0`) 인자가 실제로 ffmpeg에 전달되는지 확인하는
 * 유일한 정직한 방법 — `gopFromFps()` 단위 테스트만으로는 "그 값이 산출물에 반영됐다"를 못 잡는다.
 */
function keyframePtsSeconds(file: string): number[] {
  const raw = execFileSync(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'frame=key_frame,pkt_pts_time',
    '-of',
    'csv=p=0',
    file,
  ]).toString();
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(','))
    .filter(([isKey]) => isKey === '1')
    .map(([, pts]) => Number(pts));
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'gachinol-proc-test-'));
  tinyMp4 = join(workDir, 'source-1080p.mp4');
  smallSourceMp4 = join(workDir, 'source-480p.mp4');
  genTestVideo(tinyMp4, '1920x1080');
  genTestVideo(smallSourceMp4, '854x480');
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
    // 원본 1080p → 다운스케일 720p(캡이 실제로 작동 — 舊 240p 소스에서는 항등이라 무의미했다)
    expect(asset.height).toBe(720);
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
    // 원본 1080p → 다운스케일 360p(캡이 실제로 작동)
    expect(result.asset.height).toBe(360);
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
  test('생성된 소스 mp4 메타 추출', async () => {
    expect(existsSync(tinyMp4)).toBe(true);
    expect(await fileSize(tinyMp4)).toBeGreaterThan(0);
    const meta = await probe(tinyMp4);
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
    expect(meta.videoCodec).toBeDefined();
    expect(meta.fps).toBeCloseTo(10, 5);
  });
});

describe('processAutoEdit', () => {
  test('컷 없음(Phase 1 실경로) — 마스터/렌디션 분리 산출(대장 #232 태스크①), 타임라인 항등', async () => {
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

    const master = result.assets.find((a) => a.kind === 'edited_master')!;
    const rendition = result.assets.find((a) => a.kind === 'rendition')!;

    // ★ D1-b① 마스터 height == min(소스 height, MEDIA_MASTER_HEIGHT) — 소스가 정확히 1080이라
    //   env 기본값(1080)과 일치해야 캡이 실제로 반영됐음이 드러난다.
    expect(master.height).toBe(Math.min(1080, env.MEDIA_MASTER_HEIGHT));
    // ★ D1-b② 마스터가 렌디션보다 고화질(舊 설계는 둘이 같았다)
    expect(master.height!).toBeGreaterThan(rendition.height!);
    expect(rendition.height).toBe(720);
    // ★ D1-b③ 서로 다른 바이트 — 舊 설계(같은 로컬 파일을 두 좌표로 업로드)의 반증
    expect(master.checksumSha256).not.toBe(rendition.checksumSha256);

    // ★ 타임라인 항등 — 이게 깨지면 구독자 자막이 밀린다
    expect(result.timeline).toHaveLength(1);
    const m = result.timeline[0]!;
    expect(m.sourceStartSec).toBe(m.outputStartSec);
    expect(Math.abs(m.sourceEndSec - m.outputEndSec)).toBeLessThan(0.05);
    expect(progress.at(-1)).toBe(100);
    await rm(outDir, { recursive: true, force: true });
  }, 60000);

  // ★ D1-b④ 업스케일 금지 — 마스터 캡(1080)보다 낮은 소스(480)를 넣으면 마스터도 480이어야 한다.
  // "마스터=1080p"라는 이름/설정값에 이끌려 업스케일하면 화질 이득 없이 용량만 커진다.
  test('업스케일 금지 — 480 높이 소스는 마스터도 480(캡 1080을 채우지 않는다)', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'out-'));
    const { io } = localS3({ [source.key]: smallSourceMp4 }, outDir);
    const { job } = fakeJob('auto_edit', {
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
      outputKeyPrefix: 'contents/c1/g3/',
    } satisfies MediaJobData<'auto_edit'>);

    const result = await processAutoEdit(job, io, env);
    const master = result.assets.find((a) => a.kind === 'edited_master')!;
    const rendition = result.assets.find((a) => a.kind === 'rendition')!;
    expect(master.height).toBe(480);
    // 렌디션(캡 720)도 같은 이유로 480에 머문다 — 소스보다 커질 수 없다
    expect(rendition.height).toBe(480);
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

    // ★ A4 무반응 수리(게이트② 재검증) — 렌디션이 "소스"가 아니라 "컷된 마스터"에서 파생됐는지
    // 구조적으로 확인한다. 컷이 없는 시나리오(위 테스트)는 마스터=소스 길이라 이 구분이 서지
    // 않으므로, 반드시 길이가 갈리는 컷 시나리오에서 검증해야 한다.
    // `transcode(masterOutput, ...)`이 `transcode(input, ...)`으로 바뀌면(M3) 렌디션은 컷 전
    // 원본 길이(~1초)를 그대로 물려받아 컷된 마스터(~0.8초)와 크게 벌어진다 — 아래 두 부등식이
    // 그 벌어짐을 잡는다(비트레이트·해상도 차이로 "자연히" 성립하는 checksum/height 비교와 달리
    // 이건 "어느 파일을 입력으로 먹였는지"를 직접 구분한다).
    const rendition = result.assets.find((a) => a.kind === 'rendition')!;
    const sourceMeta = await probe(tinyMp4);
    expect(Math.abs(rendition.durationSec! - master.durationSec!)).toBeLessThan(0.15);
    expect(Math.abs(rendition.durationSec! - sourceMeta.durationSec!)).toBeGreaterThan(0.15);

    await rm(outDir, { recursive: true, force: true });
  }, 60000);
});

describe('autoEdit — closed GOP (대장 #232 A6 무반응 수리)', () => {
  test('키프레임 간격이 gopFromFps(fps) 프레임을 따른다', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'gop-'));
    const output = join(outDir, 'master.mp4');
    const sourceMeta = await probe(tinyMp4);
    const gopFrames = gopFromFps(sourceMeta.fps);

    // processAutoEdit 전체가 아니라 ffmpeg 인자 조립을 쥔 autoEdit()을 직접 호출한다
    // (워치독 테스트와 동일 관례 — 아래 'ffmpeg 워치독' describe 참고).
    await autoEdit(tinyMp4, output, {
      height: 1080,
      vbrKbps: 8000,
      loudnormI: -16,
      segments: [],
      gopFrames,
    });

    const keyframeTimes = keyframePtsSeconds(output);
    const expectedGopSec = gopFrames / sourceMeta.fps!;

    // `-g`/`-keyint_min`/`-sc_threshold 0`이 통째로 지워지면(M6) x264 기본 keyint(250)가
    // 1초짜리 소스보다 훨씬 커서(실측: 장면전환도 없어 sc_threshold 기본값으로도 안 잡힘)
    // 키프레임이 0초 1개뿐이 된다 — length 부등식이 즉시 잡는다.
    expect(keyframeTimes.length).toBeGreaterThanOrEqual(2);
    expect(keyframeTimes[0]).toBeCloseTo(0, 5);
    expect(keyframeTimes[1]).toBeCloseTo(expectedGopSec, 1);

    await rm(outDir, { recursive: true, force: true });
  }, 30000);
});
