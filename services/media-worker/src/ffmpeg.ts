import ffmpegPath from 'ffmpeg-static';
import { path as ffprobePath } from 'ffprobe-static';
import ffmpeg from 'fluent-ffmpeg';

// ffmpeg-static/ffprobe-static 바이너리 주입 — 시스템 설치 불요, CI 재현
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

export interface ProbeResult {
  durationSec?: number;
  width?: number;
  height?: number;
  bitrateKbps?: number;
  videoCodec?: string;
  audioCodec?: string;
}

export type ProgressFn = (percent: number) => void;

const clampPercent = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** 워치독 기본값(ms) — 진행/완료 신호 없이 이 시간 초과 시 강제 종료. env로 오버라이드. */
export const DEFAULT_FFMPEG_TIMEOUT_MS = 1_800_000;

/**
 * ffmpeg 실행에 무진행(stall) 워치독을 건다. arm() 호출마다 타이머를 재무장하므로
 * '진행 중'인 정상 잡은 죽이지 않고, 신호가 끊긴 hang만 timeoutMs 후 SIGKILL로 종료해 reject한다.
 * hang은 'end'/'error' 어느 이벤트도 오지 않아 BullMQ 재시도/소진 경로가 발동하지 못하는 것을 방지.
 */
function armWatchdog(
  command: ffmpeg.FfmpegCommand,
  timeoutMs: number,
  onFire: (err: Error) => void,
): { arm: () => void; clear: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const clear = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const arm = (): void => {
    clear();
    timer = setTimeout(() => {
      try {
        command.kill('SIGKILL');
      } catch {
        /* 이미 종료됨 — 무해 */
      }
      onFire(new Error(`ffmpeg 워치독 타임아웃(${timeoutMs}ms) — 무진행 hang 감지, 강제 종료`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  };
  return { arm, clear };
}

/** ffprobe — 산출물/원본 메타 추출 */
export function probe(input: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (err, data) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const video = data.streams.find((s) => s.codec_type === 'video');
      const audio = data.streams.find((s) => s.codec_type === 'audio');
      const durationSec =
        data.format.duration != null ? Number(data.format.duration) : undefined;
      const bitRate = data.format.bit_rate != null ? Number(data.format.bit_rate) : undefined;
      resolve({
        durationSec: Number.isFinite(durationSec) ? durationSec : undefined,
        width: video?.width,
        height: video?.height,
        bitrateKbps: bitRate && Number.isFinite(bitRate) ? Math.round(bitRate / 1000) : undefined,
        videoCodec: video?.codec_name,
        audioCodec: audio?.codec_name,
      });
    });
  });
}

/** 진행률 콜백 배선 공통 — percent가 없으면 무시(소진 후 100은 완료 이벤트가 담당) */
function runWithProgress(
  command: ffmpeg.FfmpegCommand,
  output: string,
  onProgress?: ProgressFn,
  timeoutMs: number = DEFAULT_FFMPEG_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      watchdog.clear();
      fn();
    };
    const watchdog = armWatchdog(command, timeoutMs, (err) => finish(() => reject(err)));
    watchdog.arm();
    command
      .on('progress', (p) => {
        watchdog.arm(); // 진행 신호마다 재무장 — 정상 진행은 죽이지 않음
        if (onProgress && typeof p.percent === 'number' && Number.isFinite(p.percent)) {
          onProgress(clampPercent(p.percent));
        }
      })
      .on('error', (err: unknown) =>
        finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
      )
      .on('end', () => finish(() => resolve()))
      .save(output);
  });
}

/**
 * H.264/AAC 트랜스코딩 — scale=-2:min(ih,H)(짝수 보정, 업스케일 방지) + faststart.
 * VBR 목표 비트레이트로 -b:v 지정(관제 대역폭 예측성).
 */
export function transcode(
  input: string,
  output: string,
  opts: { height: number; vbrKbps: number; timeoutMs?: number },
  onProgress?: ProgressFn,
): Promise<void> {
  const command = ffmpeg(input)
    .videoCodec('libx264')
    .audioCodec('aac')
    .audioBitrate('128k')
    .outputOptions([
      '-preset veryfast',
      `-vf scale=-2:'min(ih,${opts.height})'`,
      `-b:v ${opts.vbrKbps}k`,
      `-maxrate ${Math.round(opts.vbrKbps * 1.5)}k`,
      `-bufsize ${opts.vbrKbps * 2}k`,
      '-pix_fmt yuv420p',
      '-movflags +faststart',
    ]);
  return runWithProgress(command, output, onProgress, opts.timeoutMs);
}

/**
 * 자동편집(auto_edit) — 음량 정규화 + 배포 렌디션 규격 + faststart.
 *
 * ★ Phase 1은 **`silenceremove`를 쓰지 않는다.** 두 가지 이유가 겹친다:
 *  ① 효과가 거의 없다 — 2026-08-17 PoC 실측상 야외 촬영본은 환경음이 계속 있어
 *     검출된 무음이 0.6초 한 곳뿐이었고 제거해도 117.86 → 117.30초였다.
 *  ② 그런데 타임라인은 바뀐다 — `Scene.startSec`는 원본 기준이고 구독자 피드의 자막
 *     오버레이가 그 값을 그대로 쓰므로, 0.56초라도 밀리면 **전 콘텐츠 자막이 어긋난다**.
 * 즉 얻는 것 없이 자막만 깨진다. 컷은 글콘티 기반 `segments`가 생길 때(T-AI 트랙) 들어온다.
 *
 * `segments`가 있으면 `filter_complex`로 trim→concat 한다.
 * ⚠️ PoC 함정: **`-vf`와 `-filter_complex`는 함께 못 쓴다** — 컷 경로에서는 scale도
 * 필터그래프 안으로 넣어야 한다.
 */
export function autoEdit(
  input: string,
  output: string,
  opts: {
    height: number;
    vbrKbps: number;
    /** loudnorm 목표 라우드니스(LUFS). 방송 표준 -16 */
    loudnormI: number;
    /** 남길 구간 — 비면 컷 없이 전체 유지(Phase 1) */
    segments?: readonly { startSec: number; endSec: number }[];
    timeoutMs?: number;
  },
  onProgress?: ProgressFn,
): Promise<void> {
  const scale = `scale=-2:'min(ih,${opts.height})'`;
  const loudnorm = `loudnorm=I=${opts.loudnormI}:TP=-1.5:LRA=11`;
  const common = [
    '-preset veryfast',
    `-b:v ${opts.vbrKbps}k`,
    `-maxrate ${Math.round(opts.vbrKbps * 1.5)}k`,
    `-bufsize ${opts.vbrKbps * 2}k`,
    '-pix_fmt yuv420p',
    '-movflags +faststart',
  ];

  const segments = opts.segments ?? [];
  const command = ffmpeg(input).videoCodec('libx264').audioCodec('aac').audioBitrate('128k');

  if (segments.length === 0) {
    // 컷 없음 — 타임라인 항등. -vf/-af 단순 경로
    command.outputOptions([...common, `-vf ${scale}`, `-af ${loudnorm}`]);
  } else {
    // 컷 있음 — scale·loudnorm까지 전부 필터그래프 안으로(‑vf와 병용 불가)
    const parts = segments.map(
      (s, i) =>
        `[0:v]trim=${s.startSec}:${s.endSec},setpts=PTS-STARTPTS,${scale}[v${i}];` +
        `[0:a]atrim=${s.startSec}:${s.endSec},asetpts=PTS-STARTPTS[a${i}]`,
    );
    const chain = segments.map((_, i) => `[v${i}][a${i}]`).join('');
    const graph =
      `${parts.join(';')};${chain}concat=n=${segments.length}:v=1:a=1[vc][ac];` +
      `[ac]${loudnorm}[ao]`;
    command.outputOptions([...common, '-filter_complex', graph, '-map', '[vc]', '-map', '[ao]']);
  }
  return runWithProgress(command, output, onProgress, opts.timeoutMs);
}

/** 저화질 프리뷰 — 낮은 해상도·비트레이트 (기자 승인 확인용). faststart 필수(스트리밍) */
export function preview(
  input: string,
  output: string,
  opts: { maxHeight: number; maxBitrateKbps: number; timeoutMs?: number },
  onProgress?: ProgressFn,
): Promise<void> {
  const command = ffmpeg(input)
    .videoCodec('libx264')
    .audioCodec('aac')
    .audioBitrate('96k')
    .outputOptions([
      '-preset veryfast',
      `-vf scale=-2:'min(ih,${opts.maxHeight})'`,
      `-b:v ${opts.maxBitrateKbps}k`,
      `-maxrate ${opts.maxBitrateKbps}k`,
      `-bufsize ${opts.maxBitrateKbps * 2}k`,
      '-pix_fmt yuv420p',
      '-movflags +faststart',
    ]);
  return runWithProgress(command, output, onProgress, opts.timeoutMs);
}

/** 단일 프레임 JPEG 썸네일 — at초 지점, 가로 W(세로 비율 유지·짝수 보정) */
export function thumbnail(
  input: string,
  output: string,
  opts: { width: number; atSec: number; timeoutMs?: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(input)
      .seekInput(opts.atSec)
      .frames(1)
      .outputOptions([`-vf scale=${opts.width}:-2`]);
    let settled = false;
    // 썸네일은 progress 이벤트가 없어 절대 타임아웃으로 동작(단일 프레임 hang 방어)
    const watchdog = armWatchdog(command, opts.timeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS, (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    watchdog.arm();
    command
      .on('error', (err: unknown) => {
        if (settled) return;
        settled = true;
        watchdog.clear();
        reject(err instanceof Error ? err : new Error(String(err)));
      })
      .on('end', () => {
        if (settled) return;
        settled = true;
        watchdog.clear();
        resolve();
      })
      .save(output);
  });
}
