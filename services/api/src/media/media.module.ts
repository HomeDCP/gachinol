import { Module } from '@nestjs/common';
import { CloudflareCacheService } from './cloudflare-cache.service';
import { MediaAssetsService } from './media-assets.service';
import { MediaController } from './media.controller';
import { PublicMediaService } from './public-media.service';
import { S3Service } from './s3.service';

/**
 * 미디어 leaf 모듈 — Prisma(@Global)·Config만 의존(의존 그래프 최하단).
 * S3Service·MediaAssetsService·PublicMediaService·CloudflareCacheService를 export →
 * QueueModule·PipelineModule·UploadModule·ContentsModule(전이 훅)·FeedModule(공개 URL)이 소비.
 */
@Module({
  controllers: [MediaController],
  providers: [S3Service, MediaAssetsService, CloudflareCacheService, PublicMediaService],
  exports: [S3Service, MediaAssetsService, PublicMediaService, CloudflareCacheService],
})
export class MediaModule {}
