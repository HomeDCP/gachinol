import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Logger, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { patchNestJsSwagger } from 'nestjs-zod';

/**
 * nestjs-zod 4.x의 patchNestJsSwagger는 `@nestjs/swagger/dist/services/schema-object-factory`를
 * bare specifier로 require하는데, @nestjs/swagger 11.4+의 package `exports`가 해당 서브패스를
 * 막는다. 절대 경로 require는 exports 제한을 받지 않으므로 직접 로드해 파라미터로 주입한다.
 * (nestjs-zod가 swagger 11.4 대응을 릴리스하면 이 우회는 제거)
 */
function loadSchemaObjectFactory(): unknown {
  try {
    const localRequire = createRequire(__filename);
    const swaggerEntry = localRequire.resolve('@nestjs/swagger'); // .../dist/index.js
    return localRequire(join(dirname(swaggerEntry), 'services', 'schema-object-factory.js'))
      .SchemaObjectFactory;
  } catch {
    return undefined;
  }
}

/**
 * 부트스트랩·E2E 공용 앱 설정 — 프리픽스·shutdown hooks·Swagger.
 * (전역 파이프/필터/가드는 AppModule providers에서 등록)
 */
export function configureApp(app: INestApplication, opts: { nodeEnv: string }): void {
  app.setGlobalPrefix('v1', {
    exclude: ['health/liveness', 'health/readiness', 'health/version'],
  });
  app.enableShutdownHooks(); // Prisma 정리

  if (opts.nodeEnv !== 'production') {
    // Swagger는 비프로덕션만 (프로덕션 노출 여부는 미결)
    const factory = loadSchemaObjectFactory();
    if (factory) {
      patchNestJsSwagger(factory as never); // zod DTO → OpenAPI 스키마
    } else {
      new Logger('Swagger').warn(
        'SchemaObjectFactory 로드 실패 — Swagger 문서에서 zod DTO 스키마가 비어 보일 수 있습니다',
      );
    }
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Gachinol API')
        .setDescription(
          '가치놀 메인 API — 인증·사용자·지사·콘텐츠 워크플로우. ' +
            '에러 바디는 shared ApiError 단일 계약. health 2종만 terminus 표준 응답(도메인 계약 밖 유일 예외).',
        )
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, doc); // JSON: /docs-json
  }
}
