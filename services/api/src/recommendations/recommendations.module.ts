import { Inject, Logger, Module, type OnModuleDestroy, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents, type Worker } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import type { Env } from '../config/env.schema';
import { RECOMMENDATION_QUEUE_NAME } from './recommendation-job';
import { RecommendationProducerService } from './recommendation-producer.service';
import { RecommendationRankingService } from './recommendation-ranking.service';
import { RecommendationWorkflowService } from './recommendation-workflow.service';
import { createRecommendationWorker } from './recommendation-worker';
import {
  RECOMMENDATION_QUEUE,
  RECOMMENDATION_QUEUE_EVENTS,
  RECOMMENDATION_WORKER,
} from './recommendation.constants';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

const logger = new Logger('RecommendationsModule');

/** blocking 명령 내성 + 스모크 부팅 내성 — maxRetriesPerRequest:null, lazyConnect, error 흡수 */
const makeConnection = (url: string): Redis => {
  const conn = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  conn.on('error', (e) => logger.warn(`Redis 연결 오류(무시): ${e.message}`));
  return conn;
};

/** 활성 게이트 = REDIS_URL 단독 (추천 계산은 순수 로컬 DB 집계 — 외부 URL 불요) */
const gate = (config: ConfigService<Env, true>): string | null =>
  config.get('REDIS_URL', { infer: true }) ?? null;

const queueProvider: Provider = {
  provide: RECOMMENDATION_QUEUE,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): Queue | null => {
    const redis = gate(config);
    if (!redis) {
      logger.warn('REDIS_URL 미설정 — 추천 큐 미생성(생성 요청은 인라인 계산 폴백)');
      return null;
    }
    const queue = new Queue(RECOMMENDATION_QUEUE_NAME, { connection: makeConnection(redis) });
    queue.on('error', (e) => logger.warn(`추천 큐 오류(무시): ${e.message}`));
    return queue;
  },
};

const eventsProvider: Provider = {
  provide: RECOMMENDATION_QUEUE_EVENTS,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): QueueEvents | null => {
    const redis = gate(config);
    if (!redis) return null;
    const events = new QueueEvents(RECOMMENDATION_QUEUE_NAME, { connection: makeConnection(redis) });
    events.on('error', (e) => logger.warn(`추천 QueueEvents 오류(무시): ${e.message}`));
    return events;
  },
};

/** 인프로세스 추천 워커 — 게이트 만족 시에만 생성. eager 인스턴스화(부팅 처리기) */
const workerProvider: Provider = {
  provide: RECOMMENDATION_WORKER,
  inject: [ConfigService, RecommendationRankingService],
  useFactory: (
    config: ConfigService<Env, true>,
    ranking: RecommendationRankingService,
  ): Worker | null => {
    const redis = gate(config);
    if (!redis) return null;
    return createRecommendationWorker(makeConnection(redis), ranking, config);
  },
};

/**
 * 주간추천 — 생성(랭킹)·상태머신·센터 엔드포인트 5종 + 인프로세스 큐 인프라.
 * ★ 도메인 모듈을 하나도 import 하지 않는다(Prisma·Config는 @Global) → PipelineModule이 이 모듈을
 *   import해도 순환이 구조적으로 불가능하다. contents는 읽기만 하고(Prisma 직접), 매퍼는 순수 함수 재사용.
 */
@Module({
  providers: [
    queueProvider,
    eventsProvider,
    workerProvider,
    RecommendationRankingService,
    RecommendationWorkflowService,
    RecommendationProducerService,
    RecommendationsService,
  ],
  controllers: [RecommendationsController],
  exports: [RecommendationsService, RECOMMENDATION_QUEUE, RECOMMENDATION_QUEUE_EVENTS],
})
export class RecommendationsModule implements OnModuleDestroy {
  constructor(
    @Inject(RECOMMENDATION_QUEUE) private readonly queue: Queue | null,
    @Inject(RECOMMENDATION_QUEUE_EVENTS) private readonly events: QueueEvents | null,
    @Inject(RECOMMENDATION_WORKER) private readonly worker: Worker | null,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.events?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
