import { Module } from '@nestjs/common';
import { StationsModule } from '../stations/stations.module';
import { ContentWorkflowService } from './content-workflow.service';
import { ContentsController } from './contents.controller';
import { ContentsService } from './contents.service';

@Module({
  imports: [StationsModule], // 지사 존재 검증용 (순환 금지)
  controllers: [ContentsController],
  providers: [ContentsService, ContentWorkflowService],
})
export class ContentsModule {}
