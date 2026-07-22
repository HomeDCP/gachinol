import { join } from 'node:path';
import type { JobResultMap, MediaJobData } from '@gachinol/shared';
import type { Job } from 'bullmq';
import type { WorkerEnv } from '../env';
import { probe, transcode } from '../ffmpeg';
import { renditionKey, renditionProfile } from '../profiles';
import { createS3Io, fileSize, sha256File, type S3Io } from '../s3';
import { withWorkspace } from './workspace';

/**
 * transcode — 원본 → 배포용 720p H.264 rendition 1개(MVP).
 * 산출물 key: `${outputKeyPrefix}rendition/720p.mp4`, kind='rendition', label='720p'.
 * auto_edit 도입 시 edited_master 추가(계약은 assets 배열 유지).
 */
export async function processTranscode(
  job: Job<MediaJobData>,
  s3: S3Io,
  env: WorkerEnv,
): Promise<JobResultMap['transcode']> {
  const data = job.data as MediaJobData<'transcode'>;
  const profile = renditionProfile(env, data.payload);
  const outKey = renditionKey(data.outputKeyPrefix, profile.label);

  return withWorkspace(String(job.id), async (dir) => {
    const input = join(dir, 'input');
    const output = join(dir, `${profile.label}.mp4`);

    await s3.download(data.source.bucket, data.source.key, input);
    await transcode(
      input,
      output,
      { height: profile.height, vbrKbps: profile.vbrKbps, timeoutMs: env.MEDIA_FFMPEG_TIMEOUT_MS },
      (pct) => void job.updateProgress(pct),
    );

    const meta = await probe(output);
    const [sizeBytes, checksumSha256] = await Promise.all([fileSize(output), sha256File(output)]);
    await s3.upload(data.outputBucket, outKey, output, 'video/mp4');
    await job.updateProgress(100);

    return {
      assets: [
        {
          kind: 'rendition',
          bucket: data.outputBucket,
          storageKey: outKey,
          mimeType: 'video/mp4',
          sizeBytes,
          checksumSha256,
          renditionLabel: profile.label,
          durationSec: meta.durationSec,
          width: meta.width,
          height: meta.height,
          bitrateKbps: meta.bitrateKbps,
          videoCodec: meta.videoCodec,
          audioCodec: meta.audioCodec,
        },
      ],
    };
  });
}

/** 테스트 편의 — 기본 S3Io 주입 팩토리 */
export const transcodeWithEnv = (job: Job<MediaJobData>, env: WorkerEnv) =>
  processTranscode(job, createS3Io(env), env);
