import { Module } from '@nestjs/common';
import { ContentsModule } from '../contents/contents.module';
import { MediaModule } from '../media/media.module';
import { QueueModule } from '../queue/queue.module';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

/** 업로드 라우트 — ContentsService(loadOwned)·Workflow·MediaAssets·S3·Queue 오케스트레이션 */
@Module({
  imports: [ContentsModule, MediaModule, QueueModule],
  controllers: [UploadController],
  providers: [UploadService],
})
export class UploadModule {}
