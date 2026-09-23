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
 *
 * ★ 대장 #240 동반 의무(D1-a/D1-b) — 위 승격은 **해상도 축만** 넓혔고 **방향(orientation) 축**은
 * 그대로 전부 가로였다. 그래서 같은 `autoEdit()` 함수에서 세로 영상 오처리(#240)가 바로
 * 재발했다 — 이번엔 세로·정사각·회전메타 픽스처를 신설해 그 축도 닫는다:
 *  · `verticalMp4`(1080×1920) — 세로 코드 소스. 짧은 변(너비)=1080·긴 변(높이)=1920이 각각
 *    상한과 정확히 같아 **항등**이어야 한다(舊 버그는 여기서 608×1080으로 깨졌다).
 *  · `squareMp4`(1440×1440) — 정사각(긴 변=짧은 변). 두 변 다 캡을 넘어 1080×1080으로 줄어야
 *    caps가 "min(...)" 방향 무관하게 실제로 작동함을 드러낸다.
 *  · `rotatedMp4`(코드 1920×1080 + **rotation=-90 메타**) — iPhone 세로 촬영본과 동형(CLAUDE.md
 *    §11 실기 촬영본 기록). ffprobe의 streams[].width/height는 **회전 전(코드된)** 값이라
 *    1920×1080으로 보이지만, ffmpeg 필터그래프의 iw/ih는 표시행렬 자동회전 **이후** 값이라
 *    1080×1920으로 처리된다 — TS에서 probe()로 방향 판정하면 못 잡는 함정(5-2)을 여기서만 잡는다.
 *  · `lowResVerticalMp4`(720×1280) — 세로축 업스케일 금지 확인(舊 480p 케이스는 가로축뿐이었다).
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

/** `localS3().io.upload()`가 outDir에 실제로 쓰는 파일명(키의 '/' 등을 '_'로 치환) — 업로드 후
 *  산출물을 직접 ffprobe하려는 테스트가 이 경로를 써야 한다(uploaded[]의 원본 key 그대로 join하면
 *  존재하지 않는 경로가 된다). */
function uploadedFilePath(outDir: string, key: string): string {
  return join(outDir, key.replace(/[^a-zA-Z0-9._-]/g, '_'));
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
/** 대장 #240 D1-a — 세로 코드 소스(1080×1920). 짧은 변=1080·긴 변=1920 각각 상한과 동일 → 항등 */
let verticalMp4: string;
/** 대장 #240 D1-a — 정사각(1440×1440). 두 변 다 캡(1080)을 넘어야 min() 양방향이 실제로 작동함이 드러난다 */
let squareMp4: string;
/** 대장 #240 D1-b — 코드 1920×1080 + rotation=-90 메타(iPhone 세로 촬영본과 동형). iw/ih 필터
 *  판정(5-2 함정)을 검증하는 유일한 픽스처 — probe()로 판정했다면 이 소스에서 틀린다. */
let rotatedMp4: string;
/** 대장 #240 D1-b④ — 세로축 업스케일 금지. 舊 480p 케이스(smallSourceMp4)는 가로축뿐이었다 */
let lowResVerticalMp4: string;

/**
 * 테스트 소스 mp4 생성 — 오디오는 **저엔트로피 sine이 아니라 anoisesrc(white noise)**를 쓴다
 * (대장 #241). sine 톤은 AAC 인코더가 "단순하다"고 판단해 `-b:a` 목표를 채우지 않는다(실측:
 * 256k 요청에도 1초 mono sine → 실측 bit_rate ~142kbps, 128k와 구분 안 될 정도로 낮다).
 * white noise는 고엔트로피라 인코더가 목표 비트레이트를 실제로 채운다(실측: 256k 요청 →
 * mono ~217kbps, 128k 요청 → mono ~119kbps — 둘이 뚜렷이 갈려 "무슨 설정이 실제로 먹혔는지"를
 * ffprobe 실측만으로 구분할 수 있다). 채널은 고의로 미지정(-ac 없음) → 기본 모노 유지, 대장
 * #241의 "채널은 건드리지 마라" 요구를 소스 자체가 모노여야 검증할 수 있다.
 */
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
      'anoisesrc=duration=1:color=white',
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
 * 회전 메타(rotation=-90) 픽스처 생성 — 코드 치수는 `codedSize`(예: 1920x1080) 그대로 두고
 * mp4 표시행렬(display matrix)에만 회전을 싣는다. ⚠️ 실측 함정: `-metadata:s:v:0 rotate=X`를
 * **재인코딩(-c:v libx264)과 함께 주면 조용히 무시된다**(경고만 뜨고 side_data가 안 실린다,
 * 이 파일 작성 중 직접 확인). **`-c copy`(스트림 복사) 리먹스에서만** mov 먹서가 deprecated
 * rotate 태그를 실제 Display Matrix로 변환한다 — 그래서 2단계(인코딩 → 무손실 리먹스)로 만든다.
 */
function genRotatedTestVideo(dest: string, codedSize: string, rotateDeg: number): void {
  if (!ffmpegPath) throw new Error('ffmpeg-static 경로 없음');
  const base = `${dest}.base.mp4`;
  genTestVideo(base, codedSize);
  execFileSync(
    ffmpegPath,
    ['-i', base, '-c', 'copy', '-metadata:s:v:0', `rotate=${rotateDeg}`, dest],
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

/**
 * ffprobe로 오디오 스트림의 sample_rate·bit_rate·channels 실측(대장 #241 — `ProbeResult`에는
 * 없는 필드라 여기서 직접 ffprobe를 호출한다).
 */
function probeAudioStream(file: string): { sampleRate: number; bitRateKbps: number; channels: number } {
  const raw = execFileSync(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate,bit_rate,channels',
    '-of',
    'json',
    file,
  ]).toString();
  const parsed = JSON.parse(raw) as {
    streams: [{ sample_rate: string; bit_rate: string; channels: number }];
  };
  const s = parsed.streams[0];
  return {
    sampleRate: Number(s.sample_rate),
    bitRateKbps: Math.round(Number(s.bit_rate) / 1000),
    channels: s.channels,
  };
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'gachinol-proc-test-'));
  tinyMp4 = join(workDir, 'source-1080p.mp4');
  smallSourceMp4 = join(workDir, 'source-480p.mp4');
  verticalMp4 = join(workDir, 'source-vertical-1080x1920.mp4');
  squareMp4 = join(workDir, 'source-square-1440x1440.mp4');
  rotatedMp4 = join(workDir, 'source-rotated-1920x1080-rotm90.mp4');
  lowResVerticalMp4 = join(workDir, 'source-vertical-720x1280.mp4');
  genTestVideo(tinyMp4, '1920x1080');
  genTestVideo(smallSourceMp4, '854x480');
  genTestVideo(verticalMp4, '1080x1920');
  genTestVideo(squareMp4, '1440x1440');
  genRotatedTestVideo(rotatedMp4, '1920x1080', -90);
  genTestVideo(lowResVerticalMp4, '720x1280');
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

    // ★ 대장 #240 — 마스터 width/height == 회전 대칭 바운딩 박스 캡(가로 1920×1080 소스는
    //   긴 변=1920(=MEDIA_MASTER_LONG_EDGE)·짧은 변=1080(=MEDIA_MASTER_SHORT_EDGE)과 각각
    //   정확히 일치 → **항등**이어야 한다(舊 단언 `Math.min(1080, env.MEDIA_MASTER_HEIGHT)`는
    //   구 env 키가 사라져 컴파일이 깨지므로 교체 — CLAUDE.md §0-3 "테스트 계수가 줄면서 초록이
    //   될 때" 정지 조건을 피하려고 **지우지 않고 교체**했다).
    expect(master.width).toBe(env.MEDIA_MASTER_LONG_EDGE);
    expect(master.height).toBe(env.MEDIA_MASTER_SHORT_EDGE);
    // ★ D1-b② 마스터가 렌디션보다 고화질(舊 설계는 둘이 같았다)
    expect(master.height!).toBeGreaterThan(rendition.height!);
    expect(rendition.height).toBe(720);
    // ★ D1-b③ 서로 다른 바이트 — 舊 설계(같은 로컬 파일을 두 좌표로 업로드)의 반증
    expect(master.checksumSha256).not.toBe(rendition.checksumSha256);

    // ★ 대장 #241 — 마스터 오디오 48kHz·256kbps 실측(방송 표준 loudnorm과 별개 축).
    //   sine 톤이 아니라 anoisesrc(고엔트로피)로 소스를 만들었기 때문에 실측 bit_rate가
    //   목표치에 의미 있게 수렴한다 — 128k 요청 시 실측 ~119kbps, 256k 요청 시 ~217kbps로
    //   뚜렷이 갈린다(이 파일 작성 중 직접 측정). 채널은 소스가 모노라 그대로 모노여야 한다
    //   (-ac 미지정 확인 — 스테레오로 뜨면 신호가 2회 적재된 것).
    const masterAudio = probeAudioStream(uploadedFilePath(outDir, uploaded[0]!));
    expect(masterAudio.sampleRate).toBe(48000);
    expect(masterAudio.bitRateKbps).toBeGreaterThan(150); // 舊 128k 실측(~119)과 뚜렷이 구분
    expect(masterAudio.channels).toBe(1); // 소스가 모노 — -ac 강제 없음의 증거

    // ★ 타임라인 항등 — 이게 깨지면 구독자 자막이 밀린다
    expect(result.timeline).toHaveLength(1);
    const m = result.timeline[0]!;
    expect(m.sourceStartSec).toBe(m.outputStartSec);
    expect(Math.abs(m.sourceEndSec - m.outputEndSec)).toBeLessThan(0.05);
    expect(progress.at(-1)).toBe(100);
    await rm(outDir, { recursive: true, force: true });
  }, 60000);

  // ★ D1-b④ 업스케일 금지(가로축) — 마스터 짧은 변 캡(1080)보다 낮은 소스(480)를 넣으면
  // 마스터도 480이어야 한다. "마스터=1080p"라는 설정값에 이끌려 업스케일하면 화질 이득 없이
  // 용량만 커진다. 세로축 업스케일 금지는 아래 '회전 대칭 바운딩 박스' describe의
  // `lowResVerticalMp4` 케이스가 담당한다(舊: 가로축뿐이었다 — 대장 #240 동반 의무 D1-b④).
  test('업스케일 금지 — 480 높이 소스는 마스터도 항등(854×480, 캡 1920×1080을 채우지 않는다)', async () => {
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
    expect(master.width).toBe(854);
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

/**
 * 대장 #240 D1-d — 마스터가 세로·정사각·회전메타 소스에서 기대 해상도를 내는지 ffprobe 실측.
 * 舊 테스트(위 describe)는 전부 가로였다 — 이 블록이 방향(orientation) 축을 닫는다.
 */
describe('processAutoEdit — 회전 대칭 바운딩 박스(대장 #240)', () => {
  test('세로 코드 소스(1080×1920) — 짧은 변=긴 변 각각 상한과 동일해 항등', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'out-'));
    const { io } = localS3({ [source.key]: verticalMp4 }, outDir);
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
      outputKeyPrefix: 'contents/c1/vert/',
    } satisfies MediaJobData<'auto_edit'>);

    const result = await processAutoEdit(job, io, env);
    const master = result.assets.find((a) => a.kind === 'edited_master')!;
    // 舊 버그(단일 height 캡)였다면 608×1080이 나왔을 자리 — 항등 1080×1920이 그 반증이다.
    expect(master.width).toBe(1080);
    expect(master.height).toBe(1920);
    await rm(outDir, { recursive: true, force: true });
  }, 60000);

  test('정사각 소스(1440×1440) — 두 변 다 캡을 넘어 1080×1080으로 축소(min() 양방향 확인)', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'out-'));
    const { io } = localS3({ [source.key]: squareMp4 }, outDir);
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
      outputKeyPrefix: 'contents/c1/sq/',
    } satisfies MediaJobData<'auto_edit'>);

    const result = await processAutoEdit(job, io, env);
    const master = result.assets.find((a) => a.kind === 'edited_master')!;
    expect(master.width).toBe(1080);
    expect(master.height).toBe(1080);
    await rm(outDir, { recursive: true, force: true });
  }, 60000);

  // ★ 5-2 함정의 유일한 증거 — probe()로 방향을 판정했다면 이 소스(코드 1920×1080)를 가로로
  // 오판해 1920×1080을 캡으로 써 세로 결과가 나오지 않는다. 필터 식 안 iw/ih 판정만 이 케이스를
  // 통과시킨다(ffmpeg 자동회전이 필터 적용 전에 iw/ih를 이미 1080×1920으로 바꿔놓기 때문).
  test('회전 메타 소스(코드 1920×1080 + rotation=-90) — iw/ih가 자동회전 이후 값이라 세로로 처리', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'out-'));
    const { io } = localS3({ [source.key]: rotatedMp4 }, outDir);
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
      outputKeyPrefix: 'contents/c1/rot/',
    } satisfies MediaJobData<'auto_edit'>);

    const result = await processAutoEdit(job, io, env);
    const master = result.assets.find((a) => a.kind === 'edited_master')!;
    expect(master.width).toBe(1080);
    expect(master.height).toBe(1920);
    await rm(outDir, { recursive: true, force: true });
  }, 60000);

  // ★ 컷 경로(filter_complex)도 회전을 같은 방식으로 처리하는지 — 196행 `scale` 상수는
  // 컷 없음(-vf)·컷 있음(filter_complex) 양쪽에서 재사용되므로, 컷 있음 경로에서도 회전 소스가
  // 세로로 처리돼야 "한쪽만 고쳐 컷 도입 시 조용히 갈리는" 사고가 없음이 드러난다.
  test('회전 메타 소스 + 컷(segments) — filter_complex 경로도 세로로 처리', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'out-'));
    const { io } = localS3({ [source.key]: rotatedMp4 }, outDir);
    const { job } = fakeJob('auto_edit', {
      type: 'auto_edit',
      payload: {
        contentId: 'c1' as never,
        sourceAssetId: 'a1' as never,
        revisionRequestId: null,
        reanalyze: false,
        editPlan: { segments: [{ startSec: 0, endSec: 0.5 }] },
      },
      generation: 2,
      source,
      outputBucket,
      outputKeyPrefix: 'contents/c1/rotcut/',
    } satisfies MediaJobData<'auto_edit'>);

    const result = await processAutoEdit(job, io, env);
    const master = result.assets.find((a) => a.kind === 'edited_master')!;
    expect(master.width).toBe(1080);
    expect(master.height).toBe(1920);
    await rm(outDir, { recursive: true, force: true });
  }, 60000);

  // ★ D1-b④(세로축) — 舊 업스케일 금지 테스트(smallSourceMp4)는 가로축뿐이었다. 캡(1080)보다
  // 낮은 세로 소스(720×1280)를 넣으면 마스터도 항등(720×1280)이어야 한다.
  test('세로 저해상 소스(720×1280) — 업스케일 금지(캡 1080×1920을 채우지 않는다)', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'out-'));
    const { io } = localS3({ [source.key]: lowResVerticalMp4 }, outDir);
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
      outputKeyPrefix: 'contents/c1/lowvert/',
    } satisfies MediaJobData<'auto_edit'>);

    const result = await processAutoEdit(job, io, env);
    const master = result.assets.find((a) => a.kind === 'edited_master')!;
    expect(master.width).toBe(720);
    expect(master.height).toBe(1280);
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
      longEdge: 1920,
      shortEdge: 1080,
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
