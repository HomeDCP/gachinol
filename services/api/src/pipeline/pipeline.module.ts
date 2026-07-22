import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { ContentsModule } from '../contents/contents.module';
import { MediaModule } from '../media/media.module';
import { QueueModule } from '../queue/queue.module';
import { PipelineService } from './pipeline.service';

/**
 * QueueEvents 소비자 — OnModuleInit로 media·analysis 두 큐 리스너 부착.
 * 의존 방향 단일(→ Contents/Media/Queue/Analysis) → 무순환.
 * 생산자(QueueProducerService·AnalysisProducerService)와 소비자(PipelineService)의 모듈 분리가 순환 차단 핵심.
 */
@Module({
  imports: [ContentsModule, MediaModule, QueueModule, AnalysisModule],
  providers: [PipelineService],
})
export class PipelineModule {}
