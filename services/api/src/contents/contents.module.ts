import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { DistributionCoreModule } from '../distribution/distribution.module';
import { MediaModule } from '../media/media.module';
import { QueueModule } from '../queue/queue.module';
import { StationsModule } from '../stations/stations.module';
import { ContentWorkflowService } from './content-workflow.service';
import { ContentsController } from './contents.controller';
import { ContentsService } from './contents.service';
import { DistributionOrchestratorService } from './distribution-orchestrator.service';
import { PublicationsController } from './publications.controller';

@Module({
  // StationsModule: 지사 존재 검증. MediaModule: 상세 자산 조회. QueueModule: retry 재큐(인큐-애프터-커밋).
  // AnalysisModule: 상세 분석 조회(AiAnalysesService) + retry 분석 재큐(AnalysisProducerService).
  // DistributionCoreModule: 송출 트리거·재시도·회수(Publication·채널·생산자) + retry 송출 재큐.
  imports: [StationsModule, MediaModule, QueueModule, AnalysisModule, DistributionCoreModule],
  controllers: [ContentsController, PublicationsController],
  providers: [ContentsService, ContentWorkflowService, DistributionOrchestratorService],
  exports: [ContentsService, ContentWorkflowService],
})
export class ContentsModule {}
