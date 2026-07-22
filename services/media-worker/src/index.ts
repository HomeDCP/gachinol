import { loadWorkerEnv } from './env';
import { createRedisConnection } from './redis';
import { createS3Io } from './s3';
import { createMediaWorker } from './worker';

/**
 * media-worker 부팅 — env fail-fast → Redis 커넥션 → Worker 등록 → graceful shutdown.
 * DB·JWT·API 토큰 없음(순수 FFmpeg 컴퓨트, S3만). 결과는 BullMQ 잡 리턴값으로 반환.
 */
function main(): void {
  const env = loadWorkerEnv();
  const connection = createRedisConnection(env.REDIS_URL);
  const s3 = createS3Io(env);
  const worker = createMediaWorker(connection, s3, env);

  worker.on('completed', (job) => {
    console.log(`[media-worker] 완료 name=${job.name} id=${job.id}`);
  });
  worker.on('failed', (job, err) => {
    console.warn(
      `[media-worker] 실패 name=${job?.name} id=${job?.id} attemptsMade=${job?.attemptsMade}: ${err.message}`,
    );
  });
  worker.on('error', (err) => {
    console.error(`[media-worker] 워커 오류: ${err.message}`);
  });

  console.log(
    `[media-worker] 시작 — 큐 소비 대기 (concurrency=${env.MEDIA_WORKER_CONCURRENCY})`,
  );

  const shutdown = (signal: string): void => {
    console.log(`[media-worker] ${signal} 수신 — graceful shutdown`);
    void worker
      .close()
      .then(() => connection.quit())
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
