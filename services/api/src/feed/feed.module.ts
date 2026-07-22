import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';

/**
 * 구독자 공개 피드 모듈 — Prisma(@Global) + MediaModule(S3Service export 재사용).
 * 공개 read 3종만 제공(쓰기 없음). app.module.ts imports에 추가.
 */
@Module({
  imports: [MediaModule],
  controllers: [FeedController],
  providers: [FeedService],
})
export class FeedModule {}
