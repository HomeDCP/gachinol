import { join } from 'node:path';
import type { JobResultMap, MediaJobData } from '@gachinol/shared';
import type { Job } from 'bullmq';
import type { WorkerEnv } from '../env';
import { preview, probe } from '../ffmpeg';
import { previewKey, previewProfile } from '../profiles';
import { fileSize, sha256File, type S3Io } from '../s3';
import { withWorkspace } from './workspace';

/**
 * preview — 원본 → 저화질 360p 프리뷰(기자 승인 확인용).
 * 산출물 key: `${outputKeyPrefix}preview.mp4`, kind='preview', label='preview-360p'.
 */
export async function processPreview(
  job: Job<MediaJobData>,
  s3: S3Io,
  env: WorkerEnv,
): Promise<JobResultMap['preview']> {
  const data = job.data as MediaJobData<'preview'>;
  const profile = previewProfile(env, data.payload);
  const outKey = previewKey(data.outputKeyPrefix);

  return withWorkspace(String(job.id), async (dir) => {
    const input = join(dir, 'input');
    const output = join(dir, 'preview.mp4');

    await s3.download(data.source.bucket, data.source.key, input);
    await preview(
      input,
      output,
      {
        maxHeight: profile.maxHeight,
        maxBitrateKbps: profile.maxBitrateKbps,
        timeoutMs: env.MEDIA_FFMPEG_TIMEOUT_MS,
      },
      (pct) => void job.updateProgress(pct),
    );

    const meta = await probe(output);
    const [sizeBytes, checksumSha256] = await Promise.all([fileSize(output), sha256File(output)]);
    await s3.upload(data.outputBucket, outKey, output, 'video/mp4');
    await job.updateProgress(100);

    return {
      asset: {
        kind: 'preview',
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
    };
  });
}
