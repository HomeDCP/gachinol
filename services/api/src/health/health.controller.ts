import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 표준 프로브 2종 — 응답은 terminus 표준 형태로, 도메인 계약(shared) 밖의 유일한 예외.
 * 전역 프리픽스 /v1에서 제외됨 (main.ts).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('liveness')
  @HealthCheck()
  @ApiOperation({ summary: '프로세스 생존 프로브 (terminus 표준 응답 — 도메인 계약 밖)' })
  liveness() {
    return this.health.check([]);
  }

  @Public()
  @Get('readiness')
  @HealthCheck()
  @ApiOperation({ summary: '트래픽 수용 가능 프로브 — DB SELECT 1 포함 (terminus 표준 응답)' })
  readiness() {
    return this.health.check([() => this.prismaIndicator.pingCheck('database', this.prisma)]);
  }
}
