import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  TELEMETRY_MAX_BATCH_SIZE,
  TelemetryEventBatchDto,
  TelemetryService,
  type TelemetryIngestResult,
  type TelemetrySummary,
} from './telemetry.service';
import {
  extractClientIp,
  TelemetryIpRateLimiter,
  TELEMETRY_RATE_LIMIT_CAPACITY,
  TELEMETRY_RATE_LIMIT_IDLE_TTL_MS,
  TELEMETRY_RATE_LIMIT_MAX_IPS,
  TELEMETRY_RATE_LIMIT_REFILL_MS,
  TELEMETRY_RATE_LIMIT_SWEEP_INTERVAL_MS,
} from './telemetry-rate-limiter';

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
  /**
   * 대장 #79 조치④ — IP 기준 토큰버킷. `TelemetryRollup`과 동형으로 컨트롤러가 프로세스 생애주기
   * 동안 단일 인스턴스를 직접 보유한다(DI 불요, 순수 클래스). Cloudflare Quick Tunnel 뒤에 배포되어
   * `POST events`(@Public, 인증 없음)가 유일하게 인터넷에서 무제한 호출 가능한 엔드포인트가 된다 —
   * IP 추출 우선순위(CF-Connecting-IP 우선)·신뢰 한계는 `telemetry-rate-limiter.ts` 상단 주석 참고.
   */
  private readonly rateLimiter = new TelemetryIpRateLimiter(
    TELEMETRY_RATE_LIMIT_CAPACITY,
    TELEMETRY_RATE_LIMIT_REFILL_MS,
    TELEMETRY_RATE_LIMIT_MAX_IPS,
    TELEMETRY_RATE_LIMIT_IDLE_TTL_MS,
    TELEMETRY_RATE_LIMIT_SWEEP_INTERVAL_MS,
  );

  constructor(private readonly telemetry: TelemetryService) {}

  @Public()
  @Post('events')
  @HttpCode(200)
  @ApiOperation({
    summary: '계측 이벤트 배치 수신 (익명 허용) — 소비·업로드퍼널·모드선택 3트랙',
    description:
      `배열 그 자체가 바디(래핑 객체 아님). 최대 ${TELEMETRY_MAX_BATCH_SIZE}건/배치(초과 시 400). ` +
      '카탈로그 밖 이벤트 이름은 배치를 거부하지 않고 무시+카운트한다(unknownEventCount). ' +
      'IP 기준 레이트리밋 초과 시 429(IP는 CF-Connecting-IP 우선, 없으면 X-Forwarded-For로 폴백 — ' +
      '폴백 경로는 위조 가능성 있음, telemetry-rate-limiter.ts 참고).',
  })
  ingest(@Body() events: TelemetryEventBatchDto, @Req() req: Request): TelemetryIngestResult {
    const ip = extractClientIp(req);
    const { allowed, retryAfterMs } = this.rateLimiter.check(ip);
    if (!allowed) {
      throw new HttpException(
        `요청이 너무 많습니다. 약 ${Math.max(1, Math.ceil(retryAfterMs / 1000))}초 후 다시 시도해주세요.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
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
