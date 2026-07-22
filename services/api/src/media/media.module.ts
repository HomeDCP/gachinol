import { Module } from '@nestjs/common';
import { MediaAssetsService } from './media-assets.service';
import { MediaController } from './media.controller';
import { S3Service } from './s3.service';

/**
 * 미디어 leaf 모듈 — Prisma(@Global)·Config만 의존(의존 그래프 최하단).
 * S3Service·MediaAssetsService를 export → QueueModule·PipelineModule·UploadModule이 소비.
 */
@Module({
  controllers: [MediaController],
  providers: [S3Service, MediaAssetsService],
  exports: [S3Service, MediaAssetsService],
})
export class MediaModule {}
