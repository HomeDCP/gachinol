import { join } from 'node:path';
import type { JobResultMap, MediaJobData, ProducedAsset, TimelineMapping } from '@gachinol/shared';
import type { Job } from 'bullmq';
import type { WorkerEnv } from '../env';
import { autoEdit, gopFromFps, probe, transcode, type ProbeResult } from '../ffmpeg';
import { autoEditProfile, editedMasterKey, renditionKey } from '../profiles';
import { createS3Io, fileSize, sha256File, type S3Io } from '../s3';
import { withWorkspace } from './workspace';

/**
 * auto_edit — 자동편집 마스터 생성.
 *
 * Phase 1(현재)은 **컷 없는 기계편집**이다: 음량 정규화(loudnorm) + 송출 마스터 규격 + faststart.
 * `payload.editPlan`이 null이거나 `segments`가 비면 이 경로로 떨어지며, 그래서 **AI·추론 노드가
 * 전혀 없어도 파이프라인이 완주한다**(2026-08-17 PoC: 기계편집만으로 8.7초·AI 0회).
 *
 * 산출물 2건 — **인코딩은 2회**(대장 #232 태스크① — 舊 설계는 1회 인코딩·업로드 2회였다):
 *  ① 소스 → **마스터**(`edited_master`, 고화질·closed GOP). 자막을 굽지 않은 깨끗한 편집본.
 *     **재편집·아카이브의 소스**이자 YouTube/카카오 등 **송출 원천**이 된다.
 *  ② **마스터** → `rendition`(720p, MVP 시연·내부 배포용). **소스가 아니라 마스터에서** 뜬다 —
 *     그래야 렌디션이 "우리가 내보내는 것의 축소판"임이 구조적으로 보장되고, loudnorm·컷이
 *     두 번 적용되는 사고가 원천 차단된다. transcode와 **같은 key 규약**이라 기존 렌디션을
 *     덮어써 구독자가 보는 영상이 편집 결과로 교체된다.
 *  ⚠️ 두 산출물은 이제 **바이트가 다르다** — 각자 probe·size·checksum을 낸다(舊 설계는 같은
 *     로컬 파일을 두 좌표로 올려 메타를 공유했다).
 *
 * `timeline`은 api가 `Scene.startSec/endSec`를 배포본(마스터) 기준으로 재기입하는 데 쓴다.
 * 컷이 없으면 **항등 매핑 1건**이라 자막이 밀리지 않는다.
 */
export async function processAutoEdit(
  job: Job<MediaJobData>,
  s3: S3Io,
  env: WorkerEnv,
): Promise<JobResultMap['auto_edit']> {
  const data = job.data as MediaJobData<'auto_edit'>;
  const profile = autoEditProfile(env);
  const segments = data.payload.editPlan?.segments ?? [];

  const masterKey = editedMasterKey(data.outputKeyPrefix);
  const distKey = renditionKey(data.outputKeyPrefix, profile.rendition.label);

  return withWorkspace(String(job.id), async (dir) => {
    const input = join(dir, 'input');
    const masterOutput = join(dir, 'master.mp4');
    const renditionOutput = join(dir, 'rendition.mp4');

    await s3.download(data.source.bucket, data.source.key, input);

    // 컷이 없으면 입력 길이가 곧 출력 길이다. 있으면 segments 합이 출력 길이.
    // fps도 여기서 실측 — closed GOP 크기(fps÷2) 산출에 쓴다.
    const sourceMeta = await probe(input);
    const gopFrames = gopFromFps(sourceMeta.fps);

    // ① 소스 → 마스터 (고화질·closed GOP) — 진행률 0~70%
    await autoEdit(
      input,
      masterOutput,
      {
        longEdge: profile.master.longEdge,
        shortEdge: profile.master.shortEdge,
        vbrKbps: profile.master.vbrKbps,
        loudnormI: profile.loudnormI,
        segments,
        gopFrames,
        timeoutMs: env.MEDIA_FFMPEG_TIMEOUT_MS,
      },
      (pct) => void job.updateProgress(scalePct(pct, 0, 70)),
    );
    const masterMeta = await probe(masterOutput);
    const [masterSizeBytes, masterChecksum] = await Promise.all([
      fileSize(masterOutput),
      sha256File(masterOutput),
    ]);

    // ② 마스터 → 720p 렌디션 (재인코딩만, loudnorm·컷 재적용 없음) — 진행률 70~99%
    await transcode(
      masterOutput,
      renditionOutput,
      {
        height: profile.rendition.height,
        vbrKbps: profile.rendition.vbrKbps,
        timeoutMs: env.MEDIA_FFMPEG_TIMEOUT_MS,
      },
      (pct) => void job.updateProgress(scalePct(pct, 70, 99)),
    );
    const renditionMeta = await probe(renditionOutput);
    const [renditionSizeBytes, renditionChecksum] = await Promise.all([
      fileSize(renditionOutput),
      sha256File(renditionOutput),
    ]);

    await s3.upload(data.outputBucket, masterKey, masterOutput, 'video/mp4');
    await s3.upload(data.outputBucket, distKey, renditionOutput, 'video/mp4');
    await job.updateProgress(100);

    const toAsset = (
      kind: ProducedAsset['kind'],
      storageKey: string,
      meta: ProbeResult,
      sizeBytes: number,
      checksumSha256: string,
      renditionLabel?: string,
    ): ProducedAsset => ({
      kind,
      bucket: data.outputBucket,
      storageKey,
      mimeType: 'video/mp4',
      sizeBytes,
      checksumSha256,
      durationSec: meta.durationSec,
      width: meta.width,
      height: meta.height,
      bitrateKbps: meta.bitrateKbps,
      videoCodec: meta.videoCodec,
      audioCodec: meta.audioCodec,
      ...(renditionLabel ? { renditionLabel } : {}),
    });

    const assets: ProducedAsset[] = [
      toAsset('edited_master', masterKey, masterMeta, masterSizeBytes, masterChecksum),
      toAsset(
        'rendition',
        distKey,
        renditionMeta,
        renditionSizeBytes,
        renditionChecksum,
        profile.rendition.label,
      ),
    ];

    return {
      assets,
      timeline: buildTimeline(segments, sourceMeta.durationSec, masterMeta.durationSec),
    };
  });
}

/** 0~100 진행률을 [lo,hi] 구간으로 선형 재배치 — 2단계 인코딩의 전체 진행률 합성용 */
function scalePct(pct: number, lo: number, hi: number): number {
  return Math.round(lo + (pct / 100) * (hi - lo));
}

/**
 * 편집 전/후 타임라인 대응 산출.
 * · 컷 없음 → **항등 1건**. 길이는 실측(probe)을 쓰되 둘 다 없으면 빈 배열(api가 재기입을 건너뛴다).
 * · 컷 있음 → segments를 순서대로 이어붙인 누적 오프셋.
 */
export function buildTimeline(
  segments: readonly { startSec: number; endSec: number }[],
  sourceDurationSec: number | undefined,
  outputDurationSec: number | undefined,
): TimelineMapping[] {
  if (segments.length === 0) {
    const dur = outputDurationSec ?? sourceDurationSec;
    if (dur == null) return [];
    return [{ sourceStartSec: 0, sourceEndSec: dur, outputStartSec: 0, outputEndSec: dur }];
  }
  let cursor = 0;
  return segments.map((s) => {
    const len = Math.max(0, s.endSec - s.startSec);
    const m: TimelineMapping = {
      sourceStartSec: s.startSec,
      sourceEndSec: s.endSec,
      outputStartSec: cursor,
      outputEndSec: cursor + len,
    };
    cursor += len;
    return m;
  });
}

/** 테스트 편의 — 기본 S3Io 주입 팩토리 */
export const autoEditWithEnv = (job: Job<MediaJobData>, env: WorkerEnv) =>
  processAutoEdit(job, createS3Io(env), env);
