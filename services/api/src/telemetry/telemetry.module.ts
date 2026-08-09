import { Module } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

/**
 * 계측 집계 모듈(T-W1-08) — 저장 매체는 구조화 로그 + 인메모리 롤업뿐(Prisma·Redis 무접근).
 *
 * 의존성 0(Prisma조차 불요) — go-link 모듈과 같은 leaf다. 아무도 이 모듈을 import하지 않으므로
 * 순환은 구조적으로 불가능하다. app.module.ts imports에 1줄 등록.
 */
@Module({
  controllers: [TelemetryController],
  providers: [TelemetryService],
})
export class TelemetryModule {}
