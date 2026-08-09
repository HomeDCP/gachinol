import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  TELEMETRY_MAX_BATCH_SIZE,
  TelemetryEventBatchDto,
  TelemetryService,
  type TelemetryIngestResult,
  type TelemetrySummary,
} from './telemetry.service';

/**
 * 계측 집계 — 콘텐츠 소비 + 업로드 퍼널 + 모드 선택 3트랙(T-W1-08, 02 §E-16 서버분).
 *
 * 수신(`POST events`)은 구독자 웹(익명)·기자 웹(인증) 양쪽에서 온다 — 익명 시청 계측을 놓치지 않기
 * 위해 **@Public**(인증 불요). 조회(`GET summary`)는 센터 전용 — 03 KPI 3행("업로드 위저드 완주율"·
 * "업로드 중단 후 재개 성공률"·"큰 자막 모드 활성 비율")의 유일한 측정 원천이라 무단 노출을 막는다.
 */
@ApiTags('telemetry')
@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Public()
  @Post('events')
  @HttpCode(200)
  @ApiOperation({
    summary: '계측 이벤트 배치 수신 (익명 허용) — 소비·업로드퍼널·모드선택 3트랙',
    description:
      `배열 그 자체가 바디(래핑 객체 아님). 최대 ${TELEMETRY_MAX_BATCH_SIZE}건/배치(초과 시 400). ` +
      '카탈로그 밖 이벤트 이름은 배치를 거부하지 않고 무시+카운트한다(unknownEventCount).',
  })
  ingest(@Body() events: TelemetryEventBatchDto): TelemetryIngestResult {
    return this.telemetry.ingest(events);
  }

  @Get('summary')
  @ApiBearerAuth()
  @Roles('center_operator', 'admin')
  @ApiOperation({
    summary: '계측 집계 롤업 (센터 전용) — KPI 3행의 유일한 측정 원천',
  })
  summary(): TelemetrySummary {
    return this.telemetry.summary();
  }
}
