import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import {
  RECOMMENDATION_JOB_NAME,
  recommendationJobId,
  type RecommendationJobData,
  type RecommendationJobResult,
} from './recommendation-job';
import { RECOMMENDATION_QUEUE, type RecommendationQueue } from './recommendation.constants';
import { RecommendationRankingService } from './recommendation-ranking.service';

/** 인라인 폴백으로 즉시 계산했을 때의 산출물 (큐 경로면 null) */
export interface InlineComputation {
  jobId: string;
  result: RecommendationJobResult;
}

/**
 * 'recommendation' BullMQ 잡 생산자 — 결정적 jobId로 인큐(remove→add 멱등).
 * 모든 인큐는 전이 커밋 후 호출(인큐-애프터-커밋).
 *
 * ★ Redis 미설정 시 **인라인 폴백**(distribution과 다른 판단): 추천 생성은 외부 HTTP 0회·순수 DB 집계라
 *   수백 ms면 끝난다. 큐가 없다고 `generating`에 영구 고착시키는 건 무가치하다.
 *   distribution은 외부 채널 호출이 실체라 queued 고착이 정당했지만, 여기는 아니다.
 *   계산 진입점은 어느 경로든 RecommendationRankingService.rank 하나 — 트랜스포트만 분기한다.
 *   기록(applyGenerationResult)도 어느 경로든 RecommendationsService 하나뿐이다.
 */
@Injectable()
export class RecommendationProducerService {
  private readonly logger = new Logger(RecommendationProducerService.name);

  constructor(
    @Inject(RECOMMENDATION_QUEUE) private readonly queue: RecommendationQueue,
    private readonly ranking: RecommendationRankingService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** REDIS_URL 설정 시 true (미설정이면 인라인 폴백) */
  get enabled(): boolean {
    return this.queue != null;
  }

  /**
   * 큐 경로면 인큐 후 null, 폴백 경로면 그 자리에서 계산해 결과를 돌려준다.
   * 호출측(RecommendationsService)이 결과를 받으면 applyGenerationResult로 기록한다 —
   * 큐 경로에서 PipelineService가 하는 일과 동일 함수(경로별 기록 사본 없음).
   */
  async enqueueOrCompute(data: RecommendationJobData): Promise<InlineComputation | null> {
    const jobId = recommendationJobId(data.recommendationId, data.generation);
    if (!this.queue) {
      this.logger.warn(`추천 큐 비활성 — 인라인 계산 폴백 (recommendationId=${data.recommendationId})`);
      const result = await this.ranking.rank({
        weekOf: data.weekOf,
        generation: data.generation,
        excludeContentIds: data.excludeContentIds,
        ...(data.revisionNote ? { revisionNote: data.revisionNote } : {}),
      });
      return {
        jobId,
        result: {
          items: result.items,
          summary: result.summary,
          candidateCount: result.candidateCount,
        },
      };
    }

    // 재큐 멱등 — 동일 jobId 잔여분 제거 후 재add
    await this.queue.remove(jobId).catch(() => undefined);
    await this.queue.add(RECOMMENDATION_JOB_NAME, data, {
      jobId,
      attempts: this.config.get('RECOMMENDATION_JOB_ATTEMPTS', { infer: true }),
      backoff: {
        type: 'exponential',
        delay: this.config.get('RECOMMENDATION_JOB_BACKOFF_MS', { infer: true }),
      },
      // completed 잡 보존 — QueueEvents completed 핸들러의 getJob(jobId)가 returnvalue를 읽어야 함
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: false,
    });
    return null;
  }
}
