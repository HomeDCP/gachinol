import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { QueueModule } from '../queue/queue.module';
import { ResidentLinksController } from './resident-links.controller';
import { ResidentLinksService } from './resident-links.service';
import { ResidentReviewsController } from './resident-reviews.controller';
import { ResidentReviewsService } from './resident-reviews.service';

/**
 * 주민 임시 업로드 링크 + 검수 (T-W2-08 발급·수신 / T-W2-24 검수·파이프라인 진입).
 * 의존: Prisma(@Global) + MediaModule(S3Service·MediaAssetsService) + QueueModule(QueueProducerService).
 *
 * ── QueueModule 도입으로 무엇이 바뀌었나 (검수 게이트 강제 수단의 이동) ─────────────
 * T-W2-08은 "이 모듈이 QueueModule을 import하지 않는다 = 인큐할 수단 자체가 없다"를 1차 강제로 삼았다.
 * T-W2-24가 **승인 시 파이프라인 진입**을 구현하면서 그 모듈 경계 보증은 더 이상 유지할 수 없다
 * (승인은 어딘가에서 인큐를 해야 하고, 기존 인큐 경로 — UploadService의 소유 기자·`uploading` 전제 —
 * 는 무인증 업로더에게 성립하지 않는다). 대체 수단은 **두 겹**이다:
 *   ① 파일 경계로 축소 존치 — 무인증 표면을 소유한 `ResidentLinksService`는 여전히 큐를 주입받지
 *      않는다. 큐를 아는 것은 인증 전용 `ResidentReviewsService` 하나뿐이고, 그 유일한 인큐는
 *      승인 CAS + `assertPipelineEntryAllowed` 뒤에 있다.
 *   ② **엣지 수준 fail-closed 가드** — `ContentWorkflowService.applyHop`(콘텐츠 전이의 단일 관문)이
 *      `uploaded→processing`에서 `assertResidentReviewApproved`를 부른다. 어느 모듈이 무슨 잡을
 *      인큐하든 미승인 주민 콘텐츠는 processing으로 넘어가지 못한다 — 원래 ①이 커버하지 못하던
 *      "다른 모듈의 인큐"까지 막으므로 보호 범위는 오히려 넓어졌다(resident-review.gate.ts 주석).
 *
 * 이 모듈을 import하는 모듈은 없다(QueueModule→MediaModule 방향뿐) → 순환은 구조적으로 불가능.
 * exports: 게이트(`assertPipelineEntryAllowed`)를 파이프라인 진입 지점에 배선하려는 소비자를 위해 유지.
 */
@Module({
  imports: [MediaModule, QueueModule],
  controllers: [ResidentLinksController, ResidentReviewsController],
  providers: [ResidentLinksService, ResidentReviewsService],
  exports: [ResidentLinksService],
})
export class ResidentLinksModule {}
