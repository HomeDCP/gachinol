import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type { Env } from '../config/env.schema';
import { DISTRIBUTION_QUEUE_NAME, type PublishJobData, type PublishJobResult, type PublishResultItem } from './distribution-job';
import type { ChannelAdapterRegistry } from './adapters/adapter.registry';

const logger = new Logger('DistributionWorker');

/**
 * 인프로세스 BullMQ 송출 워커 — 'distribution' 잡 처리(createAnalysisWorker의 Nest DI 판, DB 무접근).
 * 각 PublishTargetItem을 레지스트리 어댑터로 송출하고 채널 단위 결과를 배열로 반환한다.
 * ★ 채널 부분실패는 returnvalue 데이터(throw 아님) — 잡을 completed로 둔다. 잡 throw면 BullMQ가
 *   전 채널 재송출(이미 성공한 채널 중복). 채널 단위 복구는 재시도 엔드포인트(failed→queued)의 몫.
 *   잡 throw는 인프라 장애(job.data 언팩 실패 등)에만 → BullMQ attempts/backoff 발동.
 */
export function createDistributionWorker(
  connection: ConnectionOptions,
  registry: ChannelAdapterRegistry,
  config: ConfigService<Env, true>,
): Worker<PublishJobData, PublishJobResult> {
  const concurrency = config.get('PUBLISH_CONCURRENCY', { infer: true });

  const worker = new Worker<PublishJobData, PublishJobResult>(
    DISTRIBUTION_QUEUE_NAME,
    async (job) => {
      const { publications } = job.data;
      const results: PublishResultItem[] = [];
      for (const target of publications) {
        const adapter = registry.get(target.platform);
        if (!adapter) {
          results.push({
            publicationId: target.publicationId,
            ok: false,
            error: `지원하지 않는 플랫폼: ${target.platform}`,
          });
          continue;
        }
        try {
          const out = await adapter.publish(target);
          results.push({
            publicationId: target.publicationId,
            ok: true,
            externalPostId: out.externalPostId,
            externalUrl: out.externalUrl,
          });
        } catch (e) {
          results.push({
            publicationId: target.publicationId,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return { results };
    },
    { connection, concurrency },
  );

  worker.on('error', (e) => logger.warn(`송출 워커 오류(무시): ${e.message}`));
  return worker;
}
