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
