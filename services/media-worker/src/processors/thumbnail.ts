import { join } from 'node:path';
import type { JobResultMap, MediaJobData } from '@gachinol/shared';
import type { Job } from 'bullmq';
import type { WorkerEnv } from '../env';
import { probe, thumbnail } from '../ffmpeg';
import { thumbnailKey, thumbnailProfile } from '../profiles';
import { fileSize, sha256File, type S3Io } from '../s3';
import { withWorkspace } from './workspace';

/**
 * thumbnail — 원본 at초 프레임 → JPEG.
 * 산출물 key: `${outputKeyPrefix}thumbnail.jpg`, kind='thumbnail'.
 * (durationSec/codecs 없음 — 정지 이미지).
 */
export async function processThumbnail(
  job: Job<MediaJobData>,
  s3: S3Io,
  env: WorkerEnv,
): Promise<JobResultMap['thumbnail']> {
  const data = job.data as MediaJobData<'thumbnail'>;
  const profile = thumbnailProfile(env);
  const outKey = thumbnailKey(data.outputKeyPrefix);

  return withWorkspace(String(job.id), async (dir) => {
    const input = join(dir, 'input');
    const output = join(dir, 'thumbnail.jpg');

    await s3.download(data.source.bucket, data.source.key, input);
    // 짧은 클립 방어 — 원본 duration 초과 시 seek이 프레임을 못 잡아 산출 실패.
    // duration의 절반과 설정값 중 작은 값으로 클램프(항상 유효 프레임 존재).
    const src = await probe(input);
    const atSec =
      src.durationSec && src.durationSec > 0
        ? Math.min(profile.atSec, src.durationSec / 2)
        : 0;
    await thumbnail(input, output, {
      width: profile.width,
      atSec,
      timeoutMs: env.MEDIA_FFMPEG_TIMEOUT_MS,
    });

    const meta = await probe(output);
    const [sizeBytes, checksumSha256] = await Promise.all([fileSize(output), sha256File(output)]);
    await s3.upload(data.outputBucket, outKey, output, 'image/jpeg');
    await job.updateProgress(100);

    return {
      asset: {
        kind: 'thumbnail',
        bucket: data.outputBucket,
        storageKey: outKey,
        mimeType: 'image/jpeg',
        sizeBytes,
        checksumSha256,
        width: meta.width,
        height: meta.height,
      },
    };
  });
}
