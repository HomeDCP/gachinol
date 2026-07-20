import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './env.schema';

/** 전역 설정 — 환경변수 zod 검증(fail-fast) */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      /**
       * README 표준 위치는 "리포 루트 .env" — cwd(services/api)만 보는 기본 동작으로는
       * 루트 .env를 아무도 읽지 않아 부팅이 실패한다. 우선순위(앞이 이김):
       * 셸 env > cwd .env > services/api/.env > 리포 루트 .env.
       * __dirname은 src/config·dist/config 양쪽 모두 services/api 2단계 아래 — 상대 깊이 동일.
       */
      envFilePath: ['.env', join(__dirname, '../../.env'), join(__dirname, '../../../../.env')],
      validate: (config) => envSchema.parse(config),
    }),
  ],
})
export class AppConfigModule {}
