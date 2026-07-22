import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type {
  AnalysisJobData,
  AnalysisJobResult,
  AnalyzeMediaRef,
  AnalyzeRequest,
} from '@gachinol/shared';
import { ANALYSIS_QUEUE_NAME } from '@gachinol/shared';
import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { S3Service } from '../media/s3.service';
import type { Env } from '../config/env.schema';
import { AiWorkerClient } from './ai-worker.client';

const logger = new Logger('AnalysisWorker');

/**
 * 인프로세스 BullMQ Analysis 워커 — 'analysis' 잡을 처리한다(createMediaWorker의 Nest DI 판).
 * 처리: source 좌표로 best-effort presign GET → AnalyzeRequest 조립 → AiWorkerClient.analyze HTTP →
 * AnalyzeResponse를 returnvalue로 반환(api QueueEvents completed 소비자가 ai_analyses 기록·전이).
 * 실패 시 throw만 — 재시도/소진은 BullMQ 잡 attempts가 담당(스텁은 mediaUrl 미접근이라 presign 실패도 무해).
 */
export function createAnalysisWorker(
  connection: ConnectionOptions,
  s3: S3Service,
  client: AiWorkerClient,
  config: ConfigService<Env, true>,
): Worker<AnalysisJobData, AnalysisJobResult> {
  const concurrency = config.get('AI_ANALYSIS_CONCURRENCY', { infer: true });

  const worker = new Worker<AnalysisJobData, AnalysisJobResult>(
    ANALYSIS_QUEUE_NAME,
    async (job) => {
      const { payload, generation, source, durationSec } = job.data;

      // 처리 시점 presign — TTL 만료 위험 제거. best-effort(스텁은 url 미접근).
      let mediaUrl: string | undefined;
      try {
        const presigned = await s3.presignGet(source.key);
        mediaUrl = presigned.url;
      } catch (e) {
        logger.warn(
          `presign GET 실패(무시, url 없이 진행): ${e instanceof Error ? e.message : e}`,
        );
      }

      // media는 url(실 제공자용)과 durationSec(스텁 힌트) 중 하나라도 있으면 실는다.
      // presign이 실패해도 durationSec은 실려야 스텁이 정상 샷 경계·요약을 산출한다.
      const media: AnalyzeMediaRef = {};
      if (mediaUrl) media.url = mediaUrl;
      if (durationSec != null) media.durationSec = durationSec;

      const req: AnalyzeRequest = {
        contentId: payload.contentId as unknown as string,
        generation,
        ...(Object.keys(media).length > 0 ? { media } : {}),
        languageHint: payload.languageHint,
      };
      return client.analyze(req);
    },
    { connection, concurrency },
  );

  worker.on('error', (e) => logger.warn(`Analysis 워커 오류(무시): ${e.message}`));
  return worker;
}
