import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { buildWebCorsOptions, parseWebOrigins, WEB_ORIGINS_ENV_KEY } from './auth/auth.service';
import type { Env } from './config/env.schema';
import { configureApp } from './setup-app';

async function bootstrap(): Promise<void> {
  // env zod 파싱 fail-fast는 AppConfigModule(validate)에서 — 누락 키 이름 나열 후 즉사
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  configureApp(app, { nodeEnv: config.get('NODE_ENV', { infer: true }) });
  enableWebCors(app, app.get(ConfigService).get<string>(WEB_ORIGINS_ENV_KEY));

  await app.listen(config.get('API_PORT', { infer: true }));
}

/**
 * 웹 오리진 CORS — `WEB_ORIGINS`(쉼표 구분) 화이트리스트에 있는 오리진에만 credentials를 허용한다.
 *
 * **미설정·전건 무효 = 전면 차단**(enableCors 미호출 → CORS 헤더 없음 → 브라우저가 크로스오리진 차단).
 * 현행 동작과 동일하므로 기존 네이티브 앱·서버간 호출(CORS 무관)에는 아무 영향이 없다.
 * 반대 기본값("미설정이면 전면 허용")은 쿠키 세션과 결합하는 순간 CSRF 통로가 된다.
 *
 * `WEB_ORIGINS`는 config/env.schema.ts(Env) 밖 키라 ConfigService 비타입 조회로 읽는다 —
 * 셸·컨테이너 environment/env_file로 주입해야 도달한다(리포 .env 파일은 zod가 벗겨낸다).
 */
function enableWebCors(app: INestApplication, raw: string | undefined): void {
  const logger = new Logger('WebCors');
  const { allowed, invalid } = parseWebOrigins(raw);
  if (invalid.length > 0) {
    logger.warn(`WEB_ORIGINS 해석 불가 항목 ${invalid.length}건 무시: ${invalid.join(', ')}`);
  }
  const options = buildWebCorsOptions(raw);
  if (!options) {
    logger.log('WEB_ORIGINS 미설정 — CORS 비활성(브라우저 크로스오리진 전면 차단)');
    return;
  }
  app.enableCors(options);
  logger.log(`웹 오리진 CORS 활성(credentials 허용): ${allowed.join(', ')}`);
}

void bootstrap();
