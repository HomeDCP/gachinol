import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type {
  AnalysisJobData,
  AnalysisJobResult,
  ContentStatus,
  JobResultMap,
  MediaJobData,
  TimelineMapping,
} from '@gachinol/shared';
import { ContentOrigin } from '@gachinol/shared';
import type { Job, Queue, QueueEvents } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { ContentWorkflowService } from '../contents/content-workflow.service';
import { MediaAssetsService } from '../media/media-assets.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueProducerService } from '../queue/queue-producer.service';
import { MEDIA_QUEUE, MEDIA_QUEUE_EVENTS } from '../queue/queue.constants';
import { ANALYSIS_QUEUE, ANALYSIS_QUEUE_EVENTS } from '../analysis/analysis.constants';
import { AnalysisProducerService } from '../analysis/analysis-producer.service';
import { AiAnalysesService } from '../analysis/ai-analyses.service';
import { DISTRIBUTION_QUEUE, DISTRIBUTION_QUEUE_EVENTS } from '../distribution/distribution.constants';
import { PublicationsService } from '../distribution/publications.service';
import type { PublishJobData, PublishJobResult } from '../distribution/distribution-job';
import {
  RECOMMENDATION_QUEUE,
  RECOMMENDATION_QUEUE_EVENTS,
} from '../recommendations/recommendation.constants';
import { RecommendationsService } from '../recommendations/recommendations.service';
import type {
  RecommendationJobData,
  RecommendationJobResult,
} from '../recommendations/recommendation-job';

/**
 * 프리뷰 완료 후 검토 대기 목적지 — **origin이 정한다**(대장 #97).
 *
 * · `reporter_upload` → 기자가 저화질 프리뷰를 확인·승인한다(CLAUDE.md §4 기자 앱 최종 단계).
 * · `live_vod`·`resident_link` → 담당 기자가 없어(`reporterId=null` 불변식) 기자 검토를 생략하고
 *   센터 검토로 직행한다. resident_link는 여기에 더해 이미 지사 담당자 검수를 통과한 물건이다.
 *
 * 이 매핑의 **권위는 `ContentWorkflowService.policyGuard`**(전이 정책의 소유자)이고 여기는 그 정책이
 * 허용하는 유일한 값을 고르는 파생이다 — 어긋나면 그 가드가 즉시 invalid_transition으로 잡는다
 * (검증되는 파생이지 자유로운 사본이 아니다). 그래서 미래에 origin이 추가되면 여기서 조용히
 * 오분류되는 게 아니라 그 가드가 거절해 로그로 드러난다(fail-loud) — 새 origin은 두 곳을 같이 고친다.
 */
const previewReviewTarget = (origin: string): ContentStatus =>
  origin === ContentOrigin.ReporterUpload ? 'awaiting_reporter_review' : 'awaiting_center_review';

/**
 * QueueEvents 소비자 — api가 유일한 DB 기록자. media·analysis 두 큐를 인프로세스로 소비해
 * MediaAsset/AiAnalysis upsert + ContentWorkflowService.applySystemTransition으로 상태전이.
 * worker→api HTTP 콜백 없음. 잡이벤트→상태전이 매핑은 shared 전이맵을 준수(전부 map-legal).
 *
 * analyzing 홉(구현됨): 일반 콘텐츠는 transcode 완료 후 processing→analyzing으로 가서 분석 잡을 인큐하고,
 * 분석 완료 시 analyzing→preview_generating으로 진행한다. 긴급(priority='urgent') 또는 AI 비활성
 * (AI_WORKER_URL 미설정)일 때만 processing→preview_generating 직행(긴급 패스트트랙·무회귀 폴백).
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
    @Inject(ANALYSIS_QUEUE_EVENTS) private readonly analysisEvents: QueueEvents | null,
    @Inject(ANALYSIS_QUEUE) private readonly analysisQueue: Queue | null,
    private readonly analysisProducer: AnalysisProducerService,
    private readonly aiAnalyses: AiAnalysesService,
    @Inject(DISTRIBUTION_QUEUE_EVENTS) private readonly distributionEvents: QueueEvents | null,
    @Inject(DISTRIBUTION_QUEUE) private readonly distributionQueue: Queue | null,
    private readonly publications: PublicationsService,
    @Inject(RECOMMENDATION_QUEUE_EVENTS) private readonly recommendationEvents: QueueEvents | null,
    @Inject(RECOMMENDATION_QUEUE) private readonly recommendationQueue: Queue | null,
    private readonly recommendations: RecommendationsService,
  ) {}

  onModuleInit(): void {
    this.initMediaListeners();
    this.initAnalysisListeners();
    this.initDistributionListeners();
    this.initRecommendationListeners();
  }

  private initMediaListeners(): void {
    if (!this.events || !this.queue) {
      this.logger.warn('Redis 미설정 — 미디어 파이프라인 리스너 비활성(잡 이벤트 미수신)');
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
    void this.reconcilePending(q).catch((e) =>
      this.logger.warn(`파이프라인 부팅 리컨사일 생략: ${e instanceof Error ? e.message : e}`),
    );
  }

  private initAnalysisListeners(): void {
    if (!this.analysisEvents || !this.analysisQueue) {
      this.logger.warn('분석 큐 미설정 — 분석 파이프라인 리스너 비활성(직행 폴백)');
      return;
    }
    const aq = this.analysisQueue;
    this.analysisEvents.on(
      'active',
      ({ jobId }) => void this.safe('analysis-active', () => this.onAnalysisActive(aq, jobId)),
    );
    this.analysisEvents.on(
      'completed',
      ({ jobId }) =>
        void this.safe('analysis-completed', () => this.onAnalysisCompleted(aq, jobId)),
    );
    this.analysisEvents.on(
      'failed',
      ({ jobId }) => void this.safe('analysis-failed', () => this.onAnalysisFailed(aq, jobId)),
    );
    this.logger.log('분석 파이프라인 리스너 활성');

    void this.reconcileAnalysisPending(aq).catch((e) =>
      this.logger.warn(`분석 부팅 리컨사일 생략: ${e instanceof Error ? e.message : e}`),
    );
  }

  private initDistributionListeners(): void {
    if (!this.distributionEvents || !this.distributionQueue) {
      this.logger.warn('송출 큐 미설정 — 송출 파이프라인 리스너 비활성(distribute는 queued만)');
      return;
    }
    const dq = this.distributionQueue;
    this.distributionEvents.on(
      'active',
      ({ jobId }) => void this.safe('publish-active', () => this.onPublishActive(dq, jobId)),
    );
    this.distributionEvents.on(
      'completed',
      ({ jobId }) => void this.safe('publish-completed', () => this.onPublishCompleted(dq, jobId)),
    );
    this.distributionEvents.on(
      'failed',
      ({ jobId }) => void this.safe('publish-failed', () => this.onPublishFailed(dq, jobId)),
    );
    this.logger.log('송출 파이프라인 리스너 활성');

    void this.reconcileDistributionPending(dq).catch((e) =>
      this.logger.warn(`송출 부팅 리컨사일 생략: ${e instanceof Error ? e.message : e}`),
    );
  }

  private initRecommendationListeners(): void {
    if (!this.recommendationEvents || !this.recommendationQueue) {
      // 큐 미설정은 기능 비활성이 아니다 — 생산자가 인라인 계산으로 폴백하므로 결과는 동일하다.
      this.logger.warn('추천 큐 미설정 — 추천 파이프라인 리스너 비활성(생성은 인라인 폴백)');
      return;
    }
    const rq = this.recommendationQueue;
    this.recommendationEvents.on(
      'completed',
      ({ jobId }) =>
        void this.safe('recommendation-completed', () => this.onRecommendationCompleted(rq, jobId)),
    );
    this.recommendationEvents.on(
      'failed',
      ({ jobId }) =>
        void this.safe('recommendation-failed', () => this.onRecommendationFailed(rq, jobId)),
    );
    this.logger.log('추천 파이프라인 리스너 활성');

    void this.reconcileRecommendationPending(rq).catch((e) =>
      this.logger.warn(`추천 부팅 리컨사일 생략: ${e instanceof Error ? e.message : e}`),
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

  /** 분석 큐 부팅 리컨사일 — onAnalysisCompleted/onAnalysisFailed 재사용(멱등 upsert·ensure 체이닝) */
  private async reconcileAnalysisPending(queue: Queue): Promise<void> {
    const completed = await queue.getJobs(['completed'], 0, -1, true);
    for (const job of completed) {
      if (job?.id)
        await this.safe('reconcile-analysis-completed', () =>
          this.onAnalysisCompleted(queue, job.id!),
        );
    }
    const failed = await queue.getJobs(['failed'], 0, -1, true);
    for (const job of failed) {
      if (job?.id)
        await this.safe('reconcile-analysis-failed', () => this.onAnalysisFailed(queue, job.id!));
    }
    this.logger.log(
      `분석 리컨사일 완료 — completed=${completed.length}, failed=${failed.length}`,
    );
  }

  /** 송출 큐 부팅 리컨사일 — onPublishCompleted/onPublishFailed 재사용(상태 CAS·applySystemTransition from-가드 멱등) */
  private async reconcileDistributionPending(queue: Queue): Promise<void> {
    const completed = await queue.getJobs(['completed'], 0, -1, true);
    for (const job of completed) {
      if (job?.id)
        await this.safe('reconcile-publish-completed', () => this.onPublishCompleted(queue, job.id!));
    }
    const failed = await queue.getJobs(['failed'], 0, -1, true);
    for (const job of failed) {
      if (job?.id)
        await this.safe('reconcile-publish-failed', () => this.onPublishFailed(queue, job.id!));
    }
    this.logger.log(
      `송출 리컨사일 완료 — completed=${completed.length}, failed=${failed.length}`,
    );
  }

  /** 추천 큐 부팅 리컨사일 — 핸들러가 상태·세대 CAS라 재적용 무해(멱등) */
  private async reconcileRecommendationPending(queue: Queue): Promise<void> {
    const completed = await queue.getJobs(['completed'], 0, -1, true);
    for (const job of completed) {
      if (job?.id)
        await this.safe('reconcile-recommendation-completed', () =>
          this.onRecommendationCompleted(queue, job.id!),
        );
    }
    const failed = await queue.getJobs(['failed'], 0, -1, true);
    for (const job of failed) {
      if (job?.id)
        await this.safe('reconcile-recommendation-failed', () =>
          this.onRecommendationFailed(queue, job.id!),
        );
    }
    this.logger.log(`추천 리컨사일 완료 — completed=${completed.length}, failed=${failed.length}`);
  }

  private async safe(evt: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(`파이프라인 ${evt} 처리 실패: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ── media 큐 핸들러 ──────────────────────────────────────

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
    // auto_edit active: 무동작. 이 잡은 preview_generating·regenerating 두 상태 안에서 도는데
    // 어느 쪽도 active 시점에 전이하지 않는다(진입 전이는 인큐-애프터-커밋이 이미 보장).
    else if (type === 'auto_edit') {
      this.logger.debug(`auto_edit active (contentId=${contentId})`);
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
        // 자산에 실린 실측 길이를 Content로 확정한다(shared Content.durationSec = "편집 완료 후 확정").
        // 이 배선이 없으면 기자·관제 목록과 구독자 피드가 전부 0:00으로 표시된다 — 실측 원천은
        // media_assets뿐이고 그 값을 읽는 화면이 없기 때문이다(재생정보만 렌디션 폴백을 갖고 있었다).
        await this.syncContentDuration(contentId);
        // ensure(active 유실 방어)
        await this.workflow.applySystemTransition(contentId, 'uploaded', 'processing', jobId);

        // 분기: 일반 + AI 활성 → analyzing(분석 인큐) / 긴급 or AI 비활성 → preview_generating 직행
        const content = await this.loadContentRow(contentId);
        const analyze = content?.priority !== 'urgent' && this.analysisProducer.enabled;
        if (analyze) {
          const hop = await this.workflow.applySystemTransition(
            contentId,
            'processing',
            'analyzing',
            jobId,
          );
          if (hop.applied && content) {
            await this.analysisProducer.enqueueAnalysis(content); // 분석(임계경로)
            await this.producer.enqueueThumbnail(content); // 썸네일 병렬(비차단)
          }
        } else {
          // 긴급 패스트트랙 또는 AI 비활성 → 기존 직행(map-legal) 보존(무회귀 폴백)
          const hop = await this.workflow.applySystemTransition(
            contentId,
            'processing',
            'preview_generating',
            jobId,
          );
          if (hop.applied && content) {
            // ★ preview_generating 진입 = auto_edit부터. 프리뷰는 편집 결과에서 떠야 한다.
            await this.producer.enqueueAutoEdit(content);
            await this.producer.enqueueThumbnail(content);
          }
        }
        return;
      }
      case 'auto_edit': {
        const result = job.returnvalue as JobResultMap['auto_edit'];
        for (const asset of result.assets) {
          await this.assets.upsertOutput(contentId, generation, jobId, asset);
        }
        // 편집 결과가 길이의 원천(shared: "편집 완료 후 확정")
        await this.syncContentDuration(contentId, generation);
        this.warnIfTimelineShifted(contentId, result.timeline);

        const content = await this.loadContentRow(contentId);
        if (!content) return; // 콘텐츠가 사라졌으면 전이 대상 없음(자산 upsert는 이미 멱등 반영)

        if (content.status === 'regenerating') {
          // 재생성 경로 — reanalyze로 목적지가 갈린다(payload가 원천).
          const p = payload as MediaJobData<'auto_edit'>['payload'];
          const reanalyze = p.reanalyze && this.analysisProducer.enabled;
          const to = reanalyze ? 'analyzing' : 'preview_generating';
          const hop = await this.workflow.applySystemTransition(
            contentId,
            'regenerating',
            to,
            jobId,
          );
          if (hop.applied) {
            if (reanalyze) await this.analysisProducer.enqueueAnalysis(content);
            else await this.producer.enqueuePreview(content);
          }
          // 재생성이 끝났으므로 이 콘텐츠의 미해결 수정요청을 해소한다.
          // ★ payload.revisionRequestId가 아니라 **contentId 기준**이다 — 재시도 경로
          // (requeueForStatus)는 그 id를 싣지 못해 payload를 원천으로 삼으면 유실된다.
          await this.workflow.resolveRevisionRequests(contentId, jobId);
        } else if (content.status === 'preview_generating') {
          // 정상 경로 — 같은 상태 안에서 preview로 체이닝(전이 없음).
          // ★ 상태 확인이 곧 재렌더 가드다: 부팅 리컨사일이 완료 잡을 재처리해도 이미
          // awaiting_*_review로 넘어갔으면 preview가 다시 인큐되지 않는다.
          await this.producer.enqueuePreview(content);
        } else {
          this.logger.debug(
            `auto_edit 완료했으나 상태가 이미 진행됨 — 후속 인큐 생략 (contentId=${contentId}, status=${content.status})`,
          );
        }
        return;
      }
      case 'preview': {
        const result = job.returnvalue as JobResultMap['preview'];
        await this.assets.upsertOutput(contentId, generation, jobId, result.asset);
        // 목적지는 origin이 정한다(대장 #97) — 舊 코드는 awaiting_reporter_review 하드코딩이라
        // 담당 기자가 없는 유래(live_vod·resident_link)가 프리뷰까지 와서 policyGuard에 막혔다.
        const content = await this.loadContentRow(contentId);
        if (!content) return; // 콘텐츠가 사라졌으면 전이할 대상이 없다(자산 upsert는 이미 멱등 반영)
        await this.workflow.applySystemTransition(
          contentId,
          'preview_generating',
          previewReviewTarget(content.origin),
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

    const lastError = this.lastErrorMutate(job);

    if (type === 'transcode') {
      await this.workflow.applySystemTransition(contentId, 'uploaded', 'processing', jobId);
      await this.workflow.applySystemTransition(
        contentId,
        'processing',
        'processing_failed',
        jobId,
        lastError,
      );
    } else if (type === 'auto_edit') {
      // auto_edit은 두 상태 안에서 돈다 — 실패 목적지도 현재 상태가 정한다.
      // (재생성 실패를 preview_failed로 보내면 재시도가 auto_edit이 아니라 preview로 가버린다.)
      const content = await this.loadContentRow(contentId);
      if (content?.status === 'regenerating') {
        await this.workflow.applySystemTransition(
          contentId,
          'regenerating',
          'regeneration_failed',
          jobId,
          lastError,
        );
      } else {
        await this.workflow.applySystemTransition(
          contentId,
          'preview_generating',
          'preview_failed',
          jobId,
          lastError,
        );
      }
    } else if (type === 'preview') {
      await this.workflow.applySystemTransition(
        contentId,
        'preview_generating',
        'preview_failed',
        jobId,
        lastError,
      );
    }
    // thumbnail failed: 무시(best-effort)
  }

  // ── analysis 큐 핸들러 ───────────────────────────────────

  /** 분석 active: 무동작(디버그 로그) — 전이는 transcode-completed의 인큐-애프터-커밋이 보장 */
  private async onAnalysisActive(queue: Queue, jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const { payload } = job.data as AnalysisJobData;
    this.logger.debug(`analysis active (contentId=${payload.contentId as unknown as string})`);
  }

  /**
   * 분석 완료 — ai_analyses upsert(유일 기록자) 먼저 → ensure 체이닝 → analyzing→preview_generating.
   * ensure 홉은 from 불일치 시 무해 no-op(유실/재수신 수렴). hop.applied 가드로 reconcile 재적용 시 중복 인큐 방지.
   */
  private async onAnalysisCompleted(queue: Queue, jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const { payload, generation } = job.data as AnalysisJobData;
    const contentId = payload.contentId as unknown as string;
    const result = job.returnvalue as AnalysisJobResult;

    await this.aiAnalyses.upsert(contentId, generation, jobId, result); // 유일 기록자, 멱등
    // ensure 체이닝(유실/재수신 수렴)
    await this.workflow.applySystemTransition(contentId, 'uploaded', 'processing', jobId);
    await this.workflow.applySystemTransition(contentId, 'processing', 'analyzing', jobId);
    const hop = await this.workflow.applySystemTransition(
      contentId,
      'analyzing',
      'preview_generating',
      jobId,
    );
    if (hop.applied) {
      const content = await this.loadContentRow(contentId);
      // ★ preview_generating 진입 = auto_edit부터(임계경로). auto_edit 완료가 preview를 이어 인큐한다.
      if (content) await this.producer.enqueueAutoEdit(content);
    }
  }

  /** 분석 실패 소진 — analyzing→analysis_failed(+lastError). 미소진은 BullMQ 자동 재시도. */
  private async onAnalysisFailed(queue: Queue, jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const { payload } = job.data as AnalysisJobData;
    const contentId = payload.contentId as unknown as string;

    if (!this.isExhausted(job)) {
      this.logger.warn(`분석 잡 실패(재시도 예정) jobId=${jobId}`);
      return;
    }
    const lastError = this.lastErrorMutate(job);
    await this.workflow.applySystemTransition(contentId, 'uploaded', 'processing', jobId);
    await this.workflow.applySystemTransition(contentId, 'processing', 'analyzing', jobId);
    await this.workflow.applySystemTransition(
      contentId,
      'analyzing',
      'analysis_failed',
      jobId,
      lastError,
    );
  }

  // ── distribution 큐 핸들러 ───────────────────────────────

  /** 송출 active: 각 Publication queued→publishing CAS(+attempts). 완료에서도 ensure(유실 방어). */
  private async onPublishActive(queue: Queue, jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const { publications } = job.data as PublishJobData;
    for (const p of publications) {
      await this.publications.beginPublishing(p.publicationId as unknown as string);
    }
  }

  /**
   * 송출 완료 — 채널 결과 반영(Publication 기록 먼저) → content 판정 전이(관제 재조회 정합).
   * resolveResult·applySystemTransition from-가드가 멱등이라 재수신/리컨사일 재적용 무해.
   */
  private async onPublishCompleted(queue: Queue, jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const result = job.returnvalue as PublishJobResult;

    // ① Publication 채널 결과 반영(유일 기록자)
    for (const r of result.results) {
      await this.publications.resolveResult(r);
    }

    // ② content 판정 — 결과 publicationId → contentId(들)
    const publicationIds = result.results.map((r) => r.publicationId as unknown as string);
    const contentIds = await this.contentIdsForPublications(publicationIds);
    for (const contentId of contentIds) {
      const summary = await this.publications.summarizeForContent(contentId);
      if (summary.allPublished) {
        await this.workflow.applySystemTransition(contentId, 'publishing', 'published', jobId);
      } else if (summary.anyFailed && !summary.anyPending) {
        await this.workflow.applySystemTransition(
          contentId,
          'publishing',
          'publish_failed',
          jobId,
          this.lastErrorNote('일부 채널 송출 실패'),
        );
      }
      // anyPending: 유지(다음 이벤트 수렴)
    }
  }

  /** 송출 잡 소진(인프라 장애) — queued/publishing Publication을 failed로 + content publishing→publish_failed. */
  private async onPublishFailed(queue: Queue, jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const { publications } = job.data as PublishJobData;

    if (!this.isExhausted(job)) {
      this.logger.warn(`송출 잡 실패(재시도 예정) jobId=${jobId}`);
      return; // BullMQ 자동 재시도
    }
    const errMsg = job.failedReason ?? '송출 잡 소진';
    const publicationIds = publications.map((p) => p.publicationId as unknown as string);
    for (const id of publicationIds) {
      await this.publications.failExhausted(id, errMsg);
    }
    const contentIds = await this.contentIdsForPublications(publicationIds);
    for (const contentId of contentIds) {
      const summary = await this.publications.summarizeForContent(contentId);
      if (summary.anyFailed && !summary.anyPending) {
        await this.workflow.applySystemTransition(
          contentId,
          'publishing',
          'publish_failed',
          jobId,
          this.lastErrorNote(errMsg),
        );
      }
    }
  }

  // ── recommendation 큐 핸들러 ─────────────────────────────

  /**
   * 추천 잡 완료 — items·summary 기록 + generating|regenerating→pending_review.
   * 기록·판정은 전부 RecommendationsService.applyGenerationResult 하나(인라인 폴백과 동일 경로).
   * 상태·세대 CAS라 재수신·리컨사일 재적용이 무해하다. 후보 0건 판정도 거기서 한다.
   */
  private async onRecommendationCompleted(queue: Queue, jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const { recommendationId, generation } = job.data as RecommendationJobData;
    const result = job.returnvalue as RecommendationJobResult;
    if (!result) return; // returnvalue 미보존(만료) — 재큐로 복구
    await this.recommendations.applyGenerationResult(recommendationId, generation, jobId, result);
  }

  /** 추천 잡 소진 — generating|regenerating→generation_failed(note=실패 사유). 미소진은 BullMQ 자동 재시도 */
  private async onRecommendationFailed(queue: Queue, jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const { recommendationId } = job.data as RecommendationJobData;

    if (!this.isExhausted(job)) {
      this.logger.warn(`추천 잡 실패(재시도 예정) jobId=${jobId}`);
      return;
    }
    await this.recommendations.failGeneration(
      recommendationId,
      jobId,
      job.failedReason ?? '추천 생성 잡 소진',
    );
  }

  /** 결과 publicationId 집합 → 소속 content id 집합(중복 제거) */
  private async contentIdsForPublications(publicationIds: readonly string[]): Promise<string[]> {
    if (publicationIds.length === 0) return [];
    const rows = await this.prisma.publication.findMany({
      where: { id: { in: [...publicationIds] } },
      select: { contentId: true },
    });
    const set = new Set<string>();
    for (const r of rows) if (r.contentId) set.add(r.contentId);
    return [...set];
  }

  private lastErrorNote(message: string): { mutate: Prisma.ContentUncheckedUpdateManyInput } {
    return {
      mutate: {
        lastError: {
          message: message.slice(0, 500),
          at: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    };
  }

  private onProgress(jobId: string, data: unknown): void {
    // 형태 정합만 확인(ContentProgressPayload) — 실제 WS emit은 후속 슬라이스
    this.logger.debug(`progress jobId=${jobId} ${JSON.stringify(data)}`);
  }

  private lastErrorMutate(job: Job): { mutate: Prisma.ContentUncheckedUpdateManyInput } {
    return {
      mutate: {
        lastError: {
          message: (job.failedReason ?? '알 수 없는 실패').slice(0, 500),
          at: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    };
  }

  /** 소진 판정 — attemptsMade >= (opts.attempts ?? 1)이면 terminal(dead) */
  private isExhausted(job: Job): boolean {
    return job.attemptsMade >= (job.opts.attempts ?? 1);
  }

  private async loadContentRow(contentId: string) {
    return this.prisma.content.findUnique({ where: { id: contentId } });
  }

  /**
   * 트랜스코딩 산출물의 실측 길이를 Content.durationSec으로 확정.
   * 멱등이며(같은 값 재기록 무해) 자산에 길이가 없으면 아무것도 쓰지 않는다 —
   * 기존 값(수동 확정분·자동편집 결과)을 null로 덮지 않기 위해서다.
   * 실패해도 파이프라인을 멈추지 않는다: 길이는 표시용 비정규화 값이고, 여기서 throw하면
   * 트랜스코딩이 끝났는데도 상태가 processing에 갇힌다.
   */
  /**
   * ★ 미구동 계약 경보 — 컷이 실제로 들어왔는데 `Scene` 시각을 재기입하지 않으면
   * 구독자 앱의 자막 오버레이(`feed.mapper.ts` `scenesToCaptions`)가 통째로 밀린다.
   *
   * Phase 1은 `silenceremove`를 쓰지 않아 타임라인이 **항등**이므로 재기입이 불필요하고,
   * 그래서 재기입 코드를 만들지 않았다(쓰이지 않는 계약을 미리 구현하지 않는다는 이 리포의 규율).
   * 대신 항등이 깨지는 순간 **로그로 드러나게** 한다 — 컷을 도입하는 슬라이스(T-AI)가
   * 이 경고를 보고 재기입을 함께 구현해야 한다. 조용히 자막이 어긋나는 것이 최악이다.
   */
  private warnIfTimelineShifted(contentId: string, timeline: readonly TimelineMapping[]): void {
    const shifted = timeline.some(
      (m) =>
        Math.abs(m.sourceStartSec - m.outputStartSec) > 0.05 ||
        Math.abs(m.sourceEndSec - m.outputEndSec) > 0.05,
    );
    if (shifted || timeline.length > 1) {
      this.logger.error(
        `auto_edit 타임라인이 항등이 아니다 — Scene 시각 재기입이 필요하지만 아직 구현되지 않았다. ` +
          `구독자 자막이 어긋난다 (contentId=${contentId}, segments=${timeline.length})`,
      );
    }
  }

  private async syncContentDuration(contentId: string, generation?: number): Promise<void> {
    try {
      // generation을 넘기면 그 세대 edited_master가 원천이 된다(shared 계약: "편집 완료 후 확정").
      const durationSec = await this.assets.findDurationSec(contentId, generation);
      if (durationSec == null) return;
      await this.prisma.content.update({ where: { id: contentId }, data: { durationSec } });
    } catch (err) {
      this.logger.warn(
        `durationSec 동기화 실패 (contentId=${contentId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
