import { Module } from '@nestjs/common';
import { ContentsModule } from '../contents/contents.module';
import { MediaModule } from '../media/media.module';
import { QueueModule } from '../queue/queue.module';
import { ResidentLinksController } from './resident-links.controller';
import { ResidentLinksService } from './resident-links.service';
import { ResidentReviewsController } from './resident-reviews.controller';
import { ResidentReviewsService } from './resident-reviews.service';

/**
 * 주민 임시 업로드 링크 + 검수 (T-W2-08 발급·수신 / T-W2-24 검수·파이프라인 진입 / T-W2-31 반려 종결).
 * 의존: Prisma(@Global) + MediaModule(S3Service·MediaAssetsService) + QueueModule(QueueProducerService)
 * + ContentsModule(ContentWorkflowService — 반려 시 Content 종결 `uploaded`→`canceled`, 대장 #112).
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
 * ── ContentsModule import의 순환 안전성 (T-W2-31) ───────────────────────────
 * 이 모듈을 import하는 모듈은 여전히 **없다**(AppModule만 등록한다) → 어느 방향으로 의존을 늘려도
 * 순환이 생기지 않는다. `ContentWorkflowService`가 이 디렉터리의 `resident-review.gate.ts`를 쓰지만
 * 그것은 Nest 프로바이더가 아니라 **순수 함수 파일**이라 모듈 그래프에 간선을 만들지 않는다
 * (그래서 게이트를 서비스가 아닌 함수로 뽑아 둔 것이 여기서 값을 한다).
 * DI 표면이 넓어지는 것(이 모듈의 모든 프로바이더가 ContentWorkflowService를 주입받을 수 있게 됨)은
 * 위 ①과 같은 방식으로 **파일 규율**로 다룬다 — 무인증 표면을 소유한 `ResidentLinksService`는
 * 전이 서비스를 주입받지 않으며, 그 규율은 이 파일이 아니라 그쪽 spec의 심볼 검사가 지킨다.
 *
 * exports: 게이트(`assertPipelineEntryAllowed`)를 파이프라인 진입 지점에 배선하려는 소비자를 위해 유지.
 */
@Module({
  imports: [MediaModule, QueueModule, ContentsModule],
  controllers: [ResidentLinksController, ResidentReviewsController],
  providers: [ResidentLinksService, ResidentReviewsService],
  exports: [ResidentLinksService],
})
export class ResidentLinksModule {}
