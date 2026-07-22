import { Inject, Logger, Module, type OnModuleDestroy, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MEDIA_QUEUE_NAME } from '@gachinol/shared';
import { Queue, QueueEvents } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { MediaModule } from '../media/media.module';
import type { Env } from '../config/env.schema';
import { MEDIA_QUEUE, MEDIA_QUEUE_EVENTS } from './queue.constants';
import { QueueProducerService } from './queue-producer.service';

const logger = new Logger('QueueModule');

/** blocking 명령 내성 + 스모크 부팅 내성 — maxRetriesPerRequest:null, lazyConnect, error 흡수 */
const makeConnection = (url: string): Redis => {
  const conn = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  conn.on('error', (e) => logger.warn(`Redis 연결 오류(무시): ${e.message}`));
  return conn;
};

/** REDIS_URL 있으면 Queue, 없으면 null (부팅 유지·업로드 라우트가 사전 가드) */
const queueProvider: Provider = {
  provide: MEDIA_QUEUE,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): Queue | null => {
    const url = config.get('REDIS_URL', { infer: true });
    if (!url) {
      logger.warn('REDIS_URL 미설정 — 미디어 큐를 생성하지 않습니다(업로드 파이프라인 비활성)');
      return null;
    }
    const queue = new Queue(MEDIA_QUEUE_NAME, { connection: makeConnection(url) });
    // bullmq 객체 자체도 error를 재발행 — 리스너 없으면 unhandled 'error'로 프로세스 크래시(스모크 부팅 내성)
    queue.on('error', (e) => logger.warn(`미디어 큐 오류(무시): ${e.message}`));
    return queue;
  },
};

/** QueueEvents(별도 커넥션) — PipelineService가 소비 */
const queueEventsProvider: Provider = {
  provide: MEDIA_QUEUE_EVENTS,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): QueueEvents | null => {
    const url = config.get('REDIS_URL', { infer: true });
    if (!url) return null;
    const events = new QueueEvents(MEDIA_QUEUE_NAME, { connection: makeConnection(url) });
    events.on('error', (e) => logger.warn(`QueueEvents 오류(무시): ${e.message}`));
    return events;
  },
};

/**
 * 미디어 큐 인프라 — 생산자(Queue) + 이벤트 리스너 소스(QueueEvents).
 * MediaModule만 의존(원본 좌표 해석) → Contents가 이 모듈을 import해도 무순환.
 * 소비자(PipelineService)는 별도 PipelineModule — produce/consume 분리가 순환 차단 핵심.
 */
@Module({
  imports: [MediaModule],
  providers: [queueProvider, queueEventsProvider, QueueProducerService],
  exports: [QueueProducerService, MEDIA_QUEUE, MEDIA_QUEUE_EVENTS],
})
export class QueueModule implements OnModuleDestroy {
  constructor(
    @Inject(MEDIA_QUEUE) private readonly queue: Queue | null,
    @Inject(MEDIA_QUEUE_EVENTS) private readonly events: QueueEvents | null,
  ) {}

  /** graceful shutdown — 커넥션/리스너 정리(열린 핸들 방지) */
  async onModuleDestroy(): Promise<void> {
    await this.events?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
