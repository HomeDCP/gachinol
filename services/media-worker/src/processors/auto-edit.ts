import { join } from 'node:path';
import type { JobResultMap, MediaJobData, ProducedAsset, TimelineMapping } from '@gachinol/shared';
import type { Job } from 'bullmq';
import type { WorkerEnv } from '../env';
import { autoEdit, probe } from '../ffmpeg';
import { autoEditProfile, editedMasterKey, renditionKey } from '../profiles';
import { createS3Io, fileSize, sha256File, type S3Io } from '../s3';
import { withWorkspace } from './workspace';

/**
 * auto_edit — 자동편집 마스터 생성.
 *
 * Phase 1(현재)은 **컷 없는 기계편집**이다: 음량 정규화(loudnorm) + 배포 렌디션 규격 + faststart.
 * `payload.editPlan`이 null이거나 `segments`가 비면 이 경로로 떨어지며, 그래서 **AI·추론 노드가
 * 전혀 없어도 파이프라인이 완주한다**(2026-08-17 PoC: 기계편집만으로 8.7초·AI 0회).
 *
 * 산출물 2건 — **인코딩은 1회**, 업로드만 2회다:
 *  · `edited_master` … 자막을 굽지 않은 깨끗한 마스터. **재편집·아카이브의 소스**가 된다
 *    (실측: 원본 4K HEVC 재편집 5.33초 vs 이 720p 마스터 1.06초 — 5배).
 *  · `rendition`     … 배포본. transcode와 **같은 key 규약**이라 기존 렌디션을 덮어써
 *    구독자가 보는 영상이 편집 결과로 교체된다.
 *  Phase 1에서 둘은 내용이 같다. 자막 번인이 들어가는 시점(T-AI 트랙)에 갈라진다.
 *
 * `timeline`은 api가 `Scene.startSec/endSec`를 배포본 기준으로 재기입하는 데 쓴다.
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
  const distKey = renditionKey(data.outputKeyPrefix, profile.renditionLabel);

  return withWorkspace(String(job.id), async (dir) => {
    const input = join(dir, 'input');
    const output = join(dir, 'edited.mp4');

    await s3.download(data.source.bucket, data.source.key, input);

    // 컷이 없으면 입력 길이가 곧 출력 길이다. 있으면 segments 합이 출력 길이.
    const sourceMeta = await probe(input);

    await autoEdit(
      input,
      output,
      {
        height: profile.height,
        vbrKbps: profile.vbrKbps,
        loudnormI: profile.loudnormI,
        segments,
        timeoutMs: env.MEDIA_FFMPEG_TIMEOUT_MS,
      },
      (pct) => void job.updateProgress(pct),
    );

    const meta = await probe(output);
    const [sizeBytes, checksumSha256] = await Promise.all([fileSize(output), sha256File(output)]);

    // 같은 로컬 파일을 두 좌표로 올린다(재인코딩 없음)
    await s3.upload(data.outputBucket, masterKey, output, 'video/mp4');
    await s3.upload(data.outputBucket, distKey, output, 'video/mp4');
    await job.updateProgress(100);

    const common = {
      bucket: data.outputBucket,
      mimeType: 'video/mp4',
      sizeBytes,
      checksumSha256,
      durationSec: meta.durationSec,
      width: meta.width,
      height: meta.height,
      bitrateKbps: meta.bitrateKbps,
      videoCodec: meta.videoCodec,
      audioCodec: meta.audioCodec,
    } as const;

    const assets: ProducedAsset[] = [
      { ...common, kind: 'edited_master', storageKey: masterKey },
      { ...common, kind: 'rendition', storageKey: distKey, renditionLabel: profile.renditionLabel },
    ];

    return { assets, timeline: buildTimeline(segments, sourceMeta.durationSec, meta.durationSec) };
  });
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
