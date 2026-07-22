import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AnalysisModule } from './analysis/analysis.module';
import { AppConfigModule } from './config/config.module';
import { ContentsModule } from './contents/contents.module';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media/media.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { StationsModule } from './stations/stations.module';
import { UploadModule } from './upload/upload.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule, // env zod fail-fast
    PrismaModule, // @Global
    HealthModule,
    AuthModule,
    UsersModule,
    StationsModule,
    MediaModule,
    QueueModule,
    AnalysisModule,
    ContentsModule,
    UploadModule,
    PipelineModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // 전역 가드 등록 순서 보장: JwtAuthGuard → RolesGuard
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
