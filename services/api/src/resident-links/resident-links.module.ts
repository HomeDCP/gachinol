import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ResidentLinksController } from './resident-links.controller';
import { ResidentLinksService } from './resident-links.service';

/**
 * 주민 임시 업로드 링크 모듈(T-W2-08) — Prisma(@Global) + MediaModule(S3Service·MediaAssetsService 재사용).
 *
 * 의존 그래프상 leaf다: ContentsModule·UploadModule·QueueModule을 import하지 않는다.
 * ① 큐를 모른다 = **인큐할 수단 자체가 없다**(검수 게이트의 구조적 강제를 모듈 경계가 보증한다),
 * ② ContentWorkflowService의 사용자 전이(담당 기자 소유권 전제)는 무인증 업로더에게 성립하지 않아
 *    쓸 일이 없다 — 콘텐츠는 'uploaded' 진입점으로 태어나 그대로 멈춘다.
 * 아무도 이 모듈을 import하지 않으므로 순환은 구조적으로 불가능하다. app.module.ts imports에 1줄 등록.
 *
 * exports: 검수 게이트 가드(`assertPipelineEntryAllowed`)를 파이프라인 진입 지점에 배선하는 후속
 * 태스크가 이 서비스를 주입받을 수 있도록 열어 둔다(GoLinkModule이 buildShareLinks를 export한 선례).
 */
@Module({
  imports: [MediaModule],
  controllers: [ResidentLinksController],
  providers: [ResidentLinksService],
  exports: [ResidentLinksService],
})
export class ResidentLinksModule {}
