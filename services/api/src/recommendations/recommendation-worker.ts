import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type { Env } from '../config/env.schema';
import {
  RECOMMENDATION_QUEUE_NAME,
  type RecommendationJobData,
  type RecommendationJobResult,
} from './recommendation-job';
import type { RecommendationRankingService } from './recommendation-ranking.service';

const logger = new Logger('RecommendationWorker');

/**
 * 인프로세스 BullMQ 추천 워커 — 'recommendation' 잡 처리(createDistributionWorker의 Nest DI 판).
 * ★ DB **write 금지**: 랭킹(read-only) 계산만 하고 결과를 returnvalue로 돌려준다.
 *   items 기록·상태 전이는 QueueEvents 소비자(PipelineService→RecommendationsService)만 수행한다
 *   (api가 유일 기록자 — analysis 홉과 정확히 동형).
 * 잡 throw는 실 실패에만 → BullMQ attempts/backoff 발동 후 소진 시 generation_failed.
 * "후보 0건"은 실패가 아니라 items:[] 데이터로 반환한다 — 판정은 기록자의 몫(순수성 유지).
 */
export function createRecommendationWorker(
  connection: ConnectionOptions,
  ranking: RecommendationRankingService,
  config: ConfigService<Env, true>,
): Worker<RecommendationJobData, RecommendationJobResult> {
  const concurrency = config.get('RECOMMENDATION_CONCURRENCY', { infer: true });

  const worker = new Worker<RecommendationJobData, RecommendationJobResult>(
    RECOMMENDATION_QUEUE_NAME,
    async (job) => {
      const { weekOf, generation, excludeContentIds, revisionNote } = job.data;
      const result = await ranking.rank({
        weekOf,
        generation,
        excludeContentIds,
        ...(revisionNote ? { revisionNote } : {}),
      });
      return {
        items: result.items,
        summary: result.summary,
        candidateCount: result.candidateCount,
      };
    },
    { connection, concurrency },
  );

  worker.on('error', (e) => logger.warn(`추천 워커 오류(무시): ${e.message}`));
  return worker;
}
