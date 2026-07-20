import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';
import { configureApp } from './setup-app';

async function bootstrap(): Promise<void> {
  // env zod 파싱 fail-fast는 AppConfigModule(validate)에서 — 누락 키 이름 나열 후 즉사
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  configureApp(app, { nodeEnv: config.get('NODE_ENV', { infer: true }) });

  await app.listen(config.get('API_PORT', { infer: true }));
}

void bootstrap();
