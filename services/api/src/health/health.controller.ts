import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 프로브 3종 — liveness·readiness는 terminus 표준 응답으로 도메인 계약(shared) 밖의 예외.
 * version은 최소 계약(`{ sha: string }`)이라 terminus를 거치지 않는다(대장 #186 — 빌드 스탬프).
 * 전역 프리픽스 /v1에서 제외됨 (main.ts).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
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

  /**
   * 배포된 이미지의 커밋 SHA — "배포된 것이 어느 커밋인가"를 묻는 유일한 런타임 경로(대장 #186).
   * `GIT_SHA`는 이미지 빌드 시 `--build-arg GIT_SHA=<sha>`로 굽는다(env.schema.ts 참조).
   * 미설정 시 'unknown' — 빈 문자열로 조용히 넘기지 않는다(규율 21).
   */
  @Public()
  @Get('version')
  @ApiOperation({ summary: '배포된 이미지의 커밋 SHA (빌드 스탬프)' })
  version(): { sha: string } {
    return { sha: this.config.get('GIT_SHA', { infer: true }) };
  }
}
