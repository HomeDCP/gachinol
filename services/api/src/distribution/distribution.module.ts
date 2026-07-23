import { Inject, Logger, Module, type OnModuleDestroy, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents, type Worker } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { MediaModule } from '../media/media.module';
import type { Env } from '../config/env.schema';
import {
  DISTRIBUTION_QUEUE,
  DISTRIBUTION_QUEUE_EVENTS,
  DISTRIBUTION_WORKER,
} from './distribution.constants';
import { DISTRIBUTION_QUEUE_NAME } from './distribution-job';
import { ChannelAccountsService } from './channel-accounts.service';
import { PublicationsService } from './publications.service';
import { DistributionProducerService } from './distribution-producer.service';
import { createDistributionWorker } from './distribution-worker';
import { ChannelAdapterRegistry } from './adapters/adapter.registry';
import { KakaoMockAdapter } from './adapters/kakao-mock.adapter';
import { KakaoRealAdapter } from './adapters/kakao-real.adapter';

const logger = new Logger('DistributionCoreModule');

/** blocking 명령 내성 + 스모크 부팅 내성 — maxRetriesPerRequest:null, lazyConnect, error 흡수 */
const makeConnection = (url: string): Redis => {
  const conn = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  conn.on('error', (e) => logger.warn(`Redis 연결 오류(무시): ${e.message}`));
  return conn;
};

/** 활성 게이트 = REDIS_URL만 (카카오 목이 배포 기본 → 외부 URL 불요) */
const gate = (config: ConfigService<Env, true>): string | null =>
  config.get('REDIS_URL', { infer: true }) ?? null;

/** 채널 어댑터 레지스트리 — KAKAO_* 둘 다 설정 시 실 어댑터, 아니면 목(배포 기본) */
const adapterRegistryProvider: Provider = {
  provide: ChannelAdapterRegistry,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): ChannelAdapterRegistry => {
    const registry = new ChannelAdapterRegistry();
    const restKey = config.get('KAKAO_REST_API_KEY', { infer: true });
    const adminKey = config.get('KAKAO_CHANNEL_ADMIN_KEY', { infer: true });
    if (restKey && adminKey) {
      registry.register(
        new KakaoRealAdapter(restKey, adminKey, config.get('AI_WORKER_TIMEOUT_MS', { infer: true })),
      );
    } else {
      registry.register(new KakaoMockAdapter());
    }
    return registry;
  },
};

const distributionQueueProvider: Provider = {
  provide: DISTRIBUTION_QUEUE,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): Queue | null => {
    const redis = gate(config);
    if (!redis) {
      logger.warn('REDIS_URL 미설정 — 송출 큐 미생성(distribute는 queued만 생성·인큐 생략 폴백)');
      return null;
    }
    const queue = new Queue(DISTRIBUTION_QUEUE_NAME, { connection: makeConnection(redis) });
    queue.on('error', (e) => logger.warn(`송출 큐 오류(무시): ${e.message}`));
    return queue;
  },
};

const distributionEventsProvider: Provider = {
  provide: DISTRIBUTION_QUEUE_EVENTS,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): QueueEvents | null => {
    const redis = gate(config);
    if (!redis) return null;
    const events = new QueueEvents(DISTRIBUTION_QUEUE_NAME, { connection: makeConnection(redis) });
    events.on('error', (e) => logger.warn(`송출 QueueEvents 오류(무시): ${e.message}`));
    return events;
  },
};

/** 인프로세스 송출 워커 — 게이트 만족 시에만 생성. eager 인스턴스화(부팅 처리기). */
const distributionWorkerProvider: Provider = {
  provide: DISTRIBUTION_WORKER,
  inject: [ConfigService, ChannelAdapterRegistry],
  useFactory: (
    config: ConfigService<Env, true>,
    registry: ChannelAdapterRegistry,
  ): Worker | null => {
    const redis = gate(config);
    if (!redis) return null;
    return createDistributionWorker(makeConnection(redis), registry, config);
  },
};

/**
 * 다채널 송출 큐 인프라 — 생산자(Queue) + 이벤트 소스(QueueEvents) + 인프로세스 Worker + 어댑터 레지스트리 + DB 기록자.
 * MediaModule(leaf)만 의존 → Contents/Pipeline이 이 모듈을 import해도 무순환(상위 모듈 미import).
 * 소비자(PipelineService)는 별도 PipelineModule에서 QUEUE/EVENTS를 주입해 소비.
 */
@Module({
  imports: [MediaModule],
  providers: [
    distributionQueueProvider,
    distributionEventsProvider,
    distributionWorkerProvider,
    adapterRegistryProvider,
    ChannelAccountsService,
    PublicationsService,
    DistributionProducerService,
  ],
  exports: [
    ChannelAccountsService,
    PublicationsService,
    DistributionProducerService,
    ChannelAdapterRegistry,
    DISTRIBUTION_QUEUE,
    DISTRIBUTION_QUEUE_EVENTS,
  ],
})
export class DistributionCoreModule implements OnModuleDestroy {
  constructor(
    @Inject(DISTRIBUTION_QUEUE) private readonly queue: Queue | null,
    @Inject(DISTRIBUTION_QUEUE_EVENTS) private readonly events: QueueEvents | null,
    @Inject(DISTRIBUTION_WORKER) private readonly worker: Worker | null,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.events?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
