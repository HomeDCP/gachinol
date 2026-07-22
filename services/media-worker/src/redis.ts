import IORedis from 'ioredis';

/**
 * BullMQ 워커용 Redis 커넥션 — `maxRetriesPerRequest: null`은 BullMQ 필수(blocking 명령 내성).
 * 'error' 핸들러 부착(미부착 시 unhandledRejection로 프로세스 크래시).
 */
export function createRedisConnection(url: string): IORedis {
  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  connection.on('error', (e: Error) => {
    console.warn(`[media-worker] Redis 연결 오류: ${e.message}`);
  });
  return connection;
}
