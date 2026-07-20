import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient 래퍼 — 부팅 시 연결 시도, enableShutdownHooks로 정리.
 * 연결 실패로 프로세스를 죽이지 않는다 — DB 다운은 /health/readiness가 보고하고,
 * 쿼리는 첫 사용 시 재연결을 시도한다 (DB 없는 스모크 테스트도 이 규약에 의존).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (e) {
      this.logger.warn(
        `DB 연결 실패 — readiness가 down으로 보고합니다: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
