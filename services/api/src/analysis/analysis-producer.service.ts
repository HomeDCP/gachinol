import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AnalysisJobData } from '@gachinol/shared';
import { ANALYSIS_JOB_NAME, analysisJobId } from '@gachinol/shared';
import type { Content as ContentRow } from '@prisma/client';
import { MediaAssetsService } from '../media/media-assets.service';
import { S3Service } from '../media/s3.service';
import type { Env } from '../config/env.schema';
import { ANALYSIS_QUEUE, type AnalysisQueue } from './analysis.constants';

/**
 * 'analysis' BullMQ 잡 생산자 — 원본 좌표를 job.data에 실어 인큐한다(QueueProducerService 동형).
 * enabled = (ANALYSIS_QUEUE != null) ⇔ REDIS_URL && AI_WORKER_URL 둘 다 설정.
 * 모든 인큐는 전이 커밋 후 호출(인큐-애프터-커밋). 결정적 jobId로 재큐 멱등(remove→add).
 */
@Injectable()
export class AnalysisProducerService {
  private readonly logger = new Logger(AnalysisProducerService.name);

  constructor(
    @Inject(ANALYSIS_QUEUE) private readonly queue: AnalysisQueue,
    private readonly assets: MediaAssetsService,
    private readonly s3: S3Service,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** REDIS_URL && AI_WORKER_URL 둘 다 설정 시에만 true (미충족 시 파이프라인은 preview_generating 직행) */
  get enabled(): boolean {
    return this.queue != null;
  }

  async enqueueAnalysis(content: ContentRow): Promise<void> {
    if (!this.queue) {
      this.logger.warn(`분석 큐 비활성 — analyze 인큐 생략 (contentId=${content.id})`);
      return;
    }
    const original = await this.assets.findOriginal(content.id, 1);
    if (!original) {
      // 정상 흐름에선 도달 불가(트랜스코딩이 원본 존재를 전제). 방어적.
      throw new Error(`원본 자산이 없어 분석 인큐할 수 없습니다 (contentId=${content.id})`);
    }
    const generation = content.generation;
    const jobId = analysisJobId(content.id, generation);
    // 트랜스코딩이 프로브한 실측 재생시간 — 스텁 분석기의 샷 경계·요약 힌트(없으면 퇴화 분석).
    // 인큐-애프터-커밋 시점엔 트랜스코딩 산출물이 이미 upsert돼 있어 재큐(재시도)에도 동일하게 채워진다.
    const durationSec = await this.assets.findDurationSec(content.id);
    const data: AnalysisJobData = {
      payload: {
        contentId: content.id as never,
        assetId: original.id as never,
        generation,
        languageHint: 'ko',
      },
      generation,
      source: { bucket: this.s3.bucket, key: original.storageKey },
      ...(durationSec != null ? { durationSec } : {}),
    };

    // 재큐 멱등 — 동일 jobId 잔여분 제거 후 재add
    await this.queue.remove(jobId).catch(() => undefined);
    await this.queue.add(ANALYSIS_JOB_NAME, data, {
      jobId,
      priority: content.priority === 'urgent' ? 1 : 5,
      attempts: this.config.get('AI_ANALYSIS_JOB_ATTEMPTS', { infer: true }),
      backoff: {
        type: 'exponential',
        delay: this.config.get('AI_ANALYSIS_JOB_BACKOFF_MS', { infer: true }),
      },
      // completed 잡 보존 — QueueEvents completed 핸들러의 getJob(jobId)가 returnvalue를 읽어야 함
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: false,
    });
  }

  /** retry() 커밋 후 재큐 — analysis_failed→analyzing 복귀 시에만 분석 재개 (그 외 no-op) */
  async requeueForStatus(content: ContentRow): Promise<void> {
    if (content.status === 'analyzing') return this.enqueueAnalysis(content);
    this.logger.debug(`requeueForStatus: 분석 재큐 대상 아님 (status=${content.status})`);
  }
}
