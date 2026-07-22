import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { JobResultMap, MediaJobData } from '@gachinol/shared';
import type { Job, Queue, QueueEvents } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { ContentWorkflowService } from '../contents/content-workflow.service';
import { MediaAssetsService } from '../media/media-assets.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueProducerService } from '../queue/queue-producer.service';
import { MEDIA_QUEUE, MEDIA_QUEUE_EVENTS } from '../queue/queue.constants';

/**
 * QueueEvents 소비자 — api가 유일한 DB 기록자. 워커 잡 결과를 인프로세스로 수신해
 * MediaAsset upsert + ContentWorkflowService.applySystemTransition으로 상태전이.
 * worker→api HTTP 콜백 없음. 잡이벤트→상태전이 매핑은 shared 전이맵을 준수(전부 map-legal).
 *
 * analyzing 홉 스킵(유보): processing→preview_generating 직행(map-legal, 긴급 패스트트랙 경로 재사용).
 * AI 분석 도입 시 transcode-completed 타깃을 analyzing으로 확장(analysis-completed에서 analyzing→preview_generating).
 */
@Injectable()
export class PipelineService implements OnModuleInit {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    @Inject(MEDIA_QUEUE_EVENTS) private readonly events: QueueEvents | null,
    @Inject(MEDIA_QUEUE) private readonly queue: Queue | null,
    private readonly workflow: ContentWorkflowService,
    private readonly assets: MediaAssetsService,
    private readonly producer: QueueProducerService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    if (!this.events || !this.queue) {
      this.logger.warn('Redis 미설정 — 파이프라인 리스너 비활성(잡 이벤트 미수신)');
      return;
    }
    const q = this.queue;
    this.events.on('active', ({ jobId }) => void this.safe('active', () => this.onActive(q, jobId)));
    this.events.on(
      'completed',
      ({ jobId }) => void this.safe('completed', () => this.onCompleted(q, jobId)),
    );
    this.events.on('failed', ({ jobId }) => void this.safe('failed', () => this.onFailed(q, jobId)));
    this.events.on(
      'progress',
      ({ jobId, data }) => void this.onProgress(jobId, data), // no-op 로그(WS 미푸시)
    );
    this.logger.log('미디어 파이프라인 리스너 활성');

    // 부팅 리컨사일 — QueueEvents는 lastEventId 미지정 시 '$'(신규 이벤트만)로 동작하므로
    // api 다운타임/재시작 중 워커가 끝낸 completed/failed는 재전달되지 않는다.
    // 종단 잡을 스캔해 미반영분을 재조정한다(핸들러는 ensure 체이닝·(bucket,storageKey) 멱등이라 재적용 안전).
    // 베스트에포트 — Redis 미가용/종료 시엔 경고만(라이브 리스너는 별개로 동작).
    void this.reconcilePending(q).catch((e) =>
      this.logger.warn(`파이프라인 부팅 리컨사일 생략: ${e instanceof Error ? e.message : e}`),
    );
  }

  /**
   * 부팅 시 큐의 completed/failed 잡을 스캔해 상태전이/자산 upsert 미반영분을 재조정한다.
   * onCompleted/onFailed와 동일 경로를 재사용 — 이미 반영된 잡은 전이맵이 map-legal이 아니거나
   * upsert가 멱등이라 무해한 no-op이 된다. (removeOnComplete age=3600으로 완료잡이 ~1h 보존됨)
   */
  private async reconcilePending(queue: Queue): Promise<void> {
    const completed = await queue.getJobs(['completed'], 0, -1, true);
    for (const job of completed) {
      if (job?.id) await this.safe('reconcile-completed', () => this.onCompleted(queue, job.id!));
    }
    const failed = await queue.getJobs(['failed'], 0, -1, true);
    for (const job of failed) {
      if (job?.id) await this.safe('reconcile-failed', () => this.onFailed(queue, job.id!));
    }
    this.logger.log(
      `파이프라인 리컨사일 완료 — completed=${completed.length}, failed=${failed.length}`,
    );
  }

  private async safe(evt: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(`파이프라인 ${evt} 처리 실패: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async onActive(queue: Queue, jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const { type, payload } = job.data as MediaJobData;
    const contentId = payload.contentId as unknown as string;
    if (type === 'transcode') {
      await this.workflow.applySystemTransition(contentId, 'uploaded', 'processing', jobId);
    }
    // preview active: 무동작(로그) / thumbnail active: 무시(best-effort)
    else if (type === 'preview') {
      this.logger.debug(`preview active (contentId=${contentId})`);
    }
  }

  private async onCompleted(queue: Queue, jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const { type, payload, generation } = job.data as MediaJobData;
    const contentId = payload.contentId as unknown as string;

    // 순서: 자산 upsert 먼저(별도 tx) → 전이. 기자 앱이 status_changed로 재조회 시 자산 선존재 보장
    switch (type) {
      case 'transcode': {
        const result = job.returnvalue as JobResultMap['transcode'];
        for (const asset of result.assets) {
          await this.assets.upsertOutput(contentId, generation, jobId, asset);
        }
        // ensure(active 유실 방어) → processing→preview_generating (analyzing 스킵)
        await this.workflow.applySystemTransition(contentId, 'uploaded', 'processing', jobId);
        const hop = await this.workflow.applySystemTransition(
          contentId,
          'processing',
          'preview_generating',
          jobId,
        );
        // 커밋 후 후속 인큐 (preview + thumbnail 병렬)
        if (hop.applied) {
          const content = await this.loadContentRow(contentId);
          if (content) {
            await this.producer.enqueuePreview(content);
            await this.producer.enqueueThumbnail(content);
          }
        }
        return;
      }
      case 'preview': {
        const result = job.returnvalue as JobResultMap['preview'];
        await this.assets.upsertOutput(contentId, generation, jobId, result.asset);
        await this.workflow.applySystemTransition(
          contentId,
          'preview_generating',
          'awaiting_reporter_review',
          jobId,
        );
        return;
      }
      case 'thumbnail': {
        const result = job.returnvalue as JobResultMap['thumbnail'];
        await this.assets.upsertOutput(contentId, generation, jobId, result.asset);
        // 전이 없음(병렬·비차단)
        return;
      }
    }
  }

  private async onFailed(queue: Queue, jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const { type, payload } = job.data as MediaJobData;
    const contentId = payload.contentId as unknown as string;

    if (!this.isExhausted(job)) {
      this.logger.warn(`잡 실패(재시도 예정) type=${type} jobId=${jobId}`);
      return; // BullMQ 자동 재시도 — 콘텐츠 무변
    }

    const lastError: Prisma.ContentUncheckedUpdateManyInput = {
      lastError: {
        message: (job.failedReason ?? '알 수 없는 실패').slice(0, 500),
        at: new Date().toISOString(),
      } as unknown as Prisma.InputJsonValue,
    };

    if (type === 'transcode') {
      await this.workflow.applySystemTransition(contentId, 'uploaded', 'processing', jobId);
      await this.workflow.applySystemTransition(contentId, 'processing', 'processing_failed', jobId, {
        mutate: lastError,
      });
    } else if (type === 'preview') {
      await this.workflow.applySystemTransition(
        contentId,
        'preview_generating',
        'preview_failed',
        jobId,
        { mutate: lastError },
      );
    }
    // thumbnail failed: 무시(best-effort)
  }

  private onProgress(jobId: string, data: unknown): void {
    // 형태 정합만 확인(ContentProgressPayload) — 실제 WS emit은 후속 슬라이스
    this.logger.debug(`progress jobId=${jobId} ${JSON.stringify(data)}`);
  }

  /** 소진 판정 — attemptsMade >= (opts.attempts ?? 1)이면 terminal(dead) */
  private isExhausted(job: Job): boolean {
    return job.attemptsMade >= (job.opts.attempts ?? 1);
  }

  private async loadContentRow(contentId: string) {
    return this.prisma.content.findUnique({ where: { id: contentId } });
  }
}
