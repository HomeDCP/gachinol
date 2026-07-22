import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { QueueModule } from '../queue/queue.module';
import { StationsModule } from '../stations/stations.module';
import { ContentWorkflowService } from './content-workflow.service';
import { ContentsController } from './contents.controller';
import { ContentsService } from './contents.service';

@Module({
  // StationsModule: 지사 존재 검증. MediaModule: 상세 자산 조회. QueueModule: retry 재큐(인큐-애프터-커밋).
  imports: [StationsModule, MediaModule, QueueModule],
  controllers: [ContentsController],
  providers: [ContentsService, ContentWorkflowService],
  exports: [ContentsService, ContentWorkflowService],
})
export class ContentsModule {}
