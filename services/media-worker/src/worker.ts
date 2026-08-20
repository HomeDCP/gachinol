import type { JobResultMap, MediaJobData, MediaJobType } from '@gachinol/shared';
import { MEDIA_QUEUE_NAME } from '@gachinol/shared';
import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type { WorkerEnv } from './env';
import { processAutoEdit } from './processors/auto-edit';
import { processPreview } from './processors/preview';
import { processThumbnail } from './processors/thumbnail';
import { processTranscode } from './processors/transcode';
import type { S3Io } from './s3';

/**
 * 미디어 워커 팩토리 — job.name(MediaJobType) 스위치로 프로세서 위임.
 * throw 시 BullMQ가 attempts/backoff에 따라 재시도(attempts는 producer=api가 결정).
 * 결과는 BullMQ job.returnvalue로 반환 → api가 QueueEvents로 수신(worker→api HTTP 없음).
 *
 * ★ E2E 하네스가 이 팩토리로 인프로세스 워커를 구동한다.
 */
export function createMediaWorker(
  connection: IORedis,
  s3: S3Io,
  env: WorkerEnv,
): Worker<MediaJobData, JobResultMap[MediaJobType]> {
  return new Worker<MediaJobData, JobResultMap[MediaJobType]>(
    MEDIA_QUEUE_NAME,
    async (job) => {
      const name = job.name as MediaJobType;
      switch (name) {
        case 'transcode':
          return processTranscode(job, s3, env);
        case 'auto_edit':
          return processAutoEdit(job, s3, env);
        case 'preview':
          return processPreview(job, s3, env);
        case 'thumbnail':
          return processThumbnail(job, s3, env);
        default:
          throw new Error(`알 수 없는 미디어 잡 타입: ${String(job.name)}`);
      }
    },
    { connection, concurrency: env.MEDIA_WORKER_CONCURRENCY },
  );
}
