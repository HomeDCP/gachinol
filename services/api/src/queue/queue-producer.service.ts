import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaJobData, MediaJobType } from '@gachinol/shared';
import { mediaJobId } from '@gachinol/shared';
import type { Content as ContentRow } from '@prisma/client';
import { MediaAssetsService } from '../media/media-assets.service';
import { S3Service } from '../media/s3.service';
import type { Env } from '../config/env.schema';
import { MEDIA_QUEUE, type MediaQueue } from './queue.constants';

/**
 * BullMQ 미디어 잡 생산자 — 소스 좌표를 job.data에 실어 인큐한다.
 * 모든 인큐는 **전이 커밋 후** 호출(인큐-애프터-커밋). 결정적 jobId로 at-least-once·재큐 멱등.
 * REDIS_URL 미설정 시 queue=null → enabled=false (호출부가 사전 가드).
 */
@Injectable()
export class QueueProducerService {
  private readonly logger = new Logger(QueueProducerService.name);

  constructor(
    @Inject(MEDIA_QUEUE) private readonly queue: MediaQueue,
    private readonly assets: MediaAssetsService,
    private readonly s3: S3Service,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get enabled(): boolean {
    return this.queue != null;
  }

  async enqueueTranscode(content: ContentRow): Promise<void> {
    const original = await this.requireOriginal(content);
    const height = this.config.get('MEDIA_RENDITION_HEIGHT', { infer: true });
    await this.add('transcode', content, original.storageKey, {
      contentId: content.id as never,
      sourceAssetId: original.id as never,
      renditionLabels: [`${height}p`],
    });
  }

  async enqueuePreview(content: ContentRow): Promise<void> {
    const original = await this.requireOriginal(content);
    await this.add('preview', content, original.storageKey, {
      contentId: content.id as never,
      sourceAssetId: original.id as never,
      maxHeight: this.config.get('MEDIA_PREVIEW_HEIGHT', { infer: true }),
      maxBitrateKbps: this.config.get('MEDIA_PREVIEW_BITRATE_KBPS', { infer: true }),
    });
  }

  async enqueueThumbnail(content: ContentRow): Promise<void> {
    const original = await this.requireOriginal(content);
    await this.add('thumbnail', content, original.storageKey, {
      contentId: content.id as never,
      sourceAssetId: original.id as never,
    });
  }

  /** retry() 커밋 후 재큐 — 실패 복귀 상태별 해당 잡. remove(jobId) 후 재add(멱등 재실행) */
  async requeueForStatus(content: ContentRow): Promise<void> {
    switch (content.status) {
      case 'processing':
        return this.enqueueTranscode(content);
      case 'preview_generating':
        return this.enqueuePreview(content);
      default:
        // uploading(=upload_failed 재시도) 등은 클라 재업로드가 트리거 → 무동작
        this.logger.debug(`requeueForStatus: 재큐 대상 아님 (status=${content.status})`);
        return;
    }
  }

  private async requireOriginal(content: ContentRow) {
    const original = await this.assets.findOriginal(content.id, 1);
    if (!original) {
      // 업로드 완료 없이 인큐 시도 — 방어적. 정상 흐름에선 도달 불가
      throw new Error(`원본 자산이 없어 인큐할 수 없습니다 (contentId=${content.id})`);
    }
    return original;
  }

  private async add<T extends MediaJobType>(
    type: T,
    content: ContentRow,
    sourceKey: string,
    payload: MediaJobData<T>['payload'],
  ): Promise<void> {
    if (!this.queue) {
      this.logger.warn(`Redis 미설정 — ${type} 인큐 생략 (contentId=${content.id})`);
      return;
    }
    const generation = content.generation;
    const jobId = mediaJobId(type, content.id, generation);
    const data: MediaJobData<T> = {
      type,
      payload,
      generation,
      source: { bucket: this.s3.bucket, key: sourceKey },
      outputBucket: this.s3.bucket,
      outputKeyPrefix: this.assets.outputPrefix(content.id, generation),
    };

    // 재큐 멱등 — 동일 jobId 잔여분 제거 후 재add (BullMQ는 완료/실패 잔류분 존재 시 add 무시)
    await this.queue.remove(jobId).catch(() => undefined);
    await this.queue.add(type, data, {
      jobId,
      priority: content.priority === 'urgent' ? 1 : 5,
      attempts: this.config.get('MEDIA_JOB_ATTEMPTS', { infer: true }),
      backoff: {
        type: 'exponential',
        delay: this.config.get('MEDIA_JOB_BACKOFF_MS', { infer: true }),
      },
      // age 기반 필수 — QueueEvents completed 핸들러의 getJob(jobId)가 returnvalue를 읽어야 함
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: false,
    });
  }
}
