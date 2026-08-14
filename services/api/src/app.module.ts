import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AnalysisModule } from './analysis/analysis.module';
import { ArbiterModule } from './arbiter/arbiter.module';
import { AppConfigModule } from './config/config.module';
import { ContentsModule } from './contents/contents.module';
import { DistributionCoreModule } from './distribution/distribution.module';
import { FeedModule } from './feed/feed.module';
import { GoLinkModule } from './go-link/go-link.module';
import { HealthModule } from './health/health.module';
import { LiveModule } from './live/live.module';
import { MediaModule } from './media/media.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { ResidentLinksModule } from './resident-links/resident-links.module';
import { StationsModule } from './stations/stations.module';
import { TelemetryModule } from './telemetry/telemetry.module';
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
    DistributionCoreModule,
    ContentsModule,
    UploadModule,
    RecommendationsModule, // 주간 콘텐츠 추천(센터) — PipelineModule보다 앞
    PipelineModule,
    FeedModule, // 구독자 공개 피드(@Public read 3종)
    GoLinkModule, // go.<도메인> 단축링크 OG SSR(@Public HTML — 카톡 미리보기·watch. 리다이렉트)
    LiveModule, // 라이브 + WebSocket(게이트웨이·LiveSession·채팅·댓글수집)
    ArbiterModule, // DCP 파이프라인 상호배제(제온 공존 — DCP_ARBITER_URL 설정 시에만 활성)
    TelemetryModule, // 계측 집계(콘텐츠 소비·업로드 퍼널·모드 선택 3트랙, 구조화 로그+인메모리 롤업)
    ResidentLinksModule, // 주민 임시 업로드 링크(무인증 발급·검증·수신 + 지사 담당자 검수 게이트)
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
