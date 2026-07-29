import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ArbiterController } from './arbiter.controller';
import { DcpArbiterClient } from './dcp-arbiter.client';
import { DcpArbiterService } from './dcp-arbiter.service';

/**
 * DCP 상호배제 아비터 — 제온 호스트를 DCP 파이프라인과 공유할 때만 활성(DCP_ARBITER_URL 게이트).
 *
 * QueueModule만 import한다(MEDIA_QUEUE 주입 = 정지/재개 대상). 아무도 이 모듈을 import하지 않으므로
 * 순환은 구조적으로 불가능하다. DCP 스택에는 읽기 전용 GET만 수행한다.
 */
@Module({
  imports: [QueueModule],
  controllers: [ArbiterController],
  providers: [DcpArbiterClient, DcpArbiterService],
  exports: [DcpArbiterService],
})
export class ArbiterModule {}
