import {
  Inject,
  Logger,
  Module,
  type OnModuleDestroy,
  type Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ANALYSIS_QUEUE_NAME } from '@gachinol/shared';
import { Queue, QueueEvents, type Worker } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { MediaModule } from '../media/media.module';
import { S3Service } from '../media/s3.service';
import type { Env } from '../config/env.schema';
import {
  ANALYSIS_QUEUE,
  ANALYSIS_QUEUE_EVENTS,
  ANALYSIS_WORKER,
} from './analysis.constants';
import { AiWorkerClient } from './ai-worker.client';
import { AiAnalysesService } from './ai-analyses.service';
import { AnalysisProducerService } from './analysis-producer.service';
import { createAnalysisWorker } from './analysis-worker';

const logger = new Logger('AnalysisModule');

/** blocking 명령 내성 + 스모크 부팅 내성 — maxRetriesPerRequest:null, lazyConnect, error 흡수 */
const makeConnection = (url: string): Redis => {
  const conn = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  conn.on('error', (e) => logger.warn(`Redis 연결 오류(무시): ${e.message}`));
  return conn;
};

/** 활성 게이트 — REDIS_URL && AI_WORKER_URL 둘 다 설정돼야 분석 홉 활성 */
const gate = (config: ConfigService<Env, true>): string | null => {
  const redis = config.get('REDIS_URL', { infer: true });
  const aiUrl = config.get('AI_WORKER_URL', { infer: true });
  return redis && aiUrl ? redis : null;
};

const analysisQueueProvider: Provider = {
  provide: ANALYSIS_QUEUE,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): Queue | null => {
    const redis = gate(config);
    if (!redis) {
      logger.warn(
        'REDIS_URL 또는 AI_WORKER_URL 미설정 — 분석 큐 미생성(transcode→preview_generating 직행 폴백)',
      );
      return null;
    }
    const queue = new Queue(ANALYSIS_QUEUE_NAME, { connection: makeConnection(redis) });
    queue.on('error', (e) => logger.warn(`분석 큐 오류(무시): ${e.message}`));
    return queue;
  },
};

const analysisEventsProvider: Provider = {
  provide: ANALYSIS_QUEUE_EVENTS,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): QueueEvents | null => {
    const redis = gate(config);
    if (!redis) return null;
    const events = new QueueEvents(ANALYSIS_QUEUE_NAME, { connection: makeConnection(redis) });
    events.on('error', (e) => logger.warn(`분석 QueueEvents 오류(무시): ${e.message}`));
    return events;
  },
};

/** 인프로세스 Analysis 워커 — 게이트 만족 시에만 생성. 모듈 로드 시 eager 인스턴스화(부팅 처리기). */
const analysisWorkerProvider: Provider = {
  provide: ANALYSIS_WORKER,
  inject: [ConfigService, S3Service, AiWorkerClient],
  useFactory: (
    config: ConfigService<Env, true>,
    s3: S3Service,
    client: AiWorkerClient,
  ): Worker | null => {
    const redis = gate(config);
    if (!redis) return null;
    return createAnalysisWorker(makeConnection(redis), s3, client, config);
  },
};

/**
 * AI 분석 큐 인프라 — 생산자(Queue) + 이벤트 소스(QueueEvents) + 인프로세스 Worker + HTTP 클라이언트 + DB 기록자.
 * MediaModule(leaf)만 의존 → Contents/Pipeline이 이 모듈을 import해도 무순환(상위 모듈 미import).
 * 소비자(PipelineService)는 별도 PipelineModule에서 ANALYSIS_QUEUE/EVENTS를 주입해 소비.
 */
@Module({
  imports: [MediaModule],
  providers: [
    analysisQueueProvider,
    analysisEventsProvider,
    analysisWorkerProvider,
    AiWorkerClient,
    AnalysisProducerService,
    AiAnalysesService,
  ],
  exports: [
    AnalysisProducerService,
    AiAnalysesService,
    ANALYSIS_QUEUE,
    ANALYSIS_QUEUE_EVENTS,
  ],
})
export class AnalysisModule implements OnModuleDestroy {
  constructor(
    @Inject(ANALYSIS_QUEUE) private readonly queue: Queue | null,
    @Inject(ANALYSIS_QUEUE_EVENTS) private readonly events: QueueEvents | null,
    @Inject(ANALYSIS_WORKER) private readonly worker: Worker | null,
  ) {}

  /** graceful shutdown — 워커/이벤트/큐 정리(열린 핸들 방지) */
  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.events?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
