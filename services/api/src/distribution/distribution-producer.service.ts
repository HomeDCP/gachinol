import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Content as ContentRow, Publication as PublicationRow } from '@prisma/client';
import { MediaAssetsService } from '../media/media-assets.service';
import { S3Service } from '../media/s3.service';
import type { Env } from '../config/env.schema';
import { ChannelAccountsService } from './channel-accounts.service';
import { PublicationsService } from './publications.service';
import {
  PUBLISH_JOB_NAME,
  publishJobId,
  type PublishJobData,
  type PublishTargetItem,
} from './distribution-job';
import { DISTRIBUTION_QUEUE, type DistributionQueue } from './distribution.constants';

/**
 * 'distribution' BullMQ 잡 생산자 — 채널+콘텐츠 좌표를 job.data에 실어 인큐한다(QueueProducer 동형).
 * 모든 인큐는 전이 커밋 후 호출(인큐-애프터-커밋). 결정적 jobId로 재큐 멱등(remove→add).
 * enabled = (DISTRIBUTION_QUEUE != null) ⇔ REDIS_URL 설정. 미설정 시 no-op(queued만 생성·인큐 생략).
 */
@Injectable()
export class DistributionProducerService {
  private readonly logger = new Logger(DistributionProducerService.name);

  constructor(
    @Inject(DISTRIBUTION_QUEUE) private readonly queue: DistributionQueue,
    private readonly channels: ChannelAccountsService,
    private readonly publications: PublicationsService,
    private readonly assets: MediaAssetsService,
    private readonly s3: S3Service,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get enabled(): boolean {
    return this.queue != null;
  }

  /** distribute·재시도 커밋 후 인큐 — publications 채널행을 PublishTargetItem으로 패킹 */
  async enqueuePublish(
    content: ContentRow,
    publications: readonly PublicationRow[],
  ): Promise<void> {
    if (!this.queue) {
      this.logger.warn(`송출 큐 비활성 — publish 인큐 생략 (contentId=${content.id})`);
      return;
    }
    if (publications.length === 0) return;

    const message = await this.buildMessage(content);
    const channelMap = await this.channels.findByIds(publications.map((p) => p.channelAccountId));

    const targets: PublishTargetItem[] = [];
    for (const p of publications) {
      const ch = channelMap.get(p.channelAccountId);
      if (!ch) {
        // 채널 삭제 등 — 좌표 부재 시 건너뜀(워커에 넘길 게 없음)
        this.logger.warn(`채널 계정 부재로 패킹 제외 (publicationId=${p.id})`);
        continue;
      }
      targets.push({
        publicationId: p.id as never,
        platform: p.platform,
        externalChannelId: ch.externalChannelId,
        credentialRef: ch.credentialRef,
        idempotencyKey: p.id,
        message,
      });
    }
    if (targets.length === 0) return;

    const data: PublishJobData = { publications: targets };
    // jobId는 실제 인큐되는 publication 집합으로 결정 — 전체 distribute와 채널별 retry가 서로 clobber하지 않게.
    const jobId = publishJobId(
      content.id,
      content.generation,
      targets.map((t) => t.publicationId),
    );

    await this.queue.remove(jobId).catch(() => undefined);
    await this.queue.add(PUBLISH_JOB_NAME, data, {
      jobId,
      priority: content.priority === 'urgent' ? 1 : 5,
      attempts: this.config.get('PUBLISH_JOB_ATTEMPTS', { infer: true }),
      backoff: {
        type: 'exponential',
        delay: this.config.get('PUBLISH_JOB_BACKOFF_MS', { infer: true }),
      },
      // completed 잡 보존 — QueueEvents completed 핸들러의 getJob(jobId)가 returnvalue를 읽어야 함
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: false,
    });
  }

  /**
   * 콘텐츠 단위 retry() 커밋 후 재큐 — publish_failed→publishing 복귀 시에만 작동(그 외 no-op).
   * content의 failed Publication 전부를 failed→queued로 되돌린 뒤 재인큐한다.
   */
  async requeueForStatus(content: ContentRow): Promise<void> {
    if (content.status !== 'publishing') {
      this.logger.debug(`requeueForStatus: 송출 재큐 대상 아님 (status=${content.status})`);
      return;
    }
    const requeued = await this.publications.requeueFailedForContent(content.id);
    await this.enqueuePublish(content, requeued);
  }

  /** 송출 메시지 — 제목·설명 + 720p 재생 URL·썸네일 서명(best-effort, 실패해도 인큐 진행) */
  private async buildMessage(content: ContentRow): Promise<PublishTargetItem['message']> {
    const message: PublishTargetItem['message'] = { title: content.title };
    if (content.description) message.description = content.description;

    const assets = await this.assets.listForContent(content.id, content.generation).catch(() => []);
    const rendition =
      assets.find(
        (a) => a.kind === 'rendition' && a.renditionLabel === '720p' && a.status === 'ready',
      ) ?? assets.find((a) => a.kind === 'rendition' && a.status === 'ready');
    const thumbnail = assets.find((a) => a.kind === 'thumbnail' && a.status === 'ready');

    if (rendition) {
      try {
        message.playbackUrl = (await this.s3.presignGet(rendition.storageKey)).url;
      } catch {
        // S3 자격 미설정 등 — 인큐는 진행, playbackUrl 생략
      }
    }
    if (thumbnail) {
      try {
        message.thumbnailUrl = (await this.s3.presignGet(thumbnail.storageKey)).url;
      } catch {
        // best-effort
      }
    }
    return message;
  }
}
