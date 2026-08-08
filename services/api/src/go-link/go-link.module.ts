import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { GoLinkController } from './go-link.controller';
import { GoLinkService } from './go-link.service';

/**
 * `go.<도메인>` 단축링크 OG SSR 모듈 — Prisma(@Global) + MediaModule(S3Service export 재사용).
 *
 * 공개 read 전용(쓰기·전이 없음)이라 FeedModule과 같은 위치의 leaf다. 아무도 이 모듈을
 * import하지 않으므로 순환은 구조적으로 불가능하다. app.module.ts imports에 1줄 등록.
 */
@Module({
  imports: [MediaModule],
  controllers: [GoLinkController],
  providers: [GoLinkService],
  exports: [GoLinkService], // 후속: 반자동 게시자산 준비가 buildShareLinks를 소비(조치 2)
})
export class GoLinkModule {}
