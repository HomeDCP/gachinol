import { Module, type OnModuleDestroy, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Platform } from '@gachinol/shared';
import { DistributionCoreModule } from '../distribution/distribution.module';
import type { Env } from '../config/env.schema';
import { COMMENT_SOURCE_REGISTRY } from './live.constants';
import { CommentSourceRegistry } from './adapters/comment-source.registry';
import { CommentMockAdapter } from './adapters/comment-mock.adapter';
import { RealCommentSourceAdapter } from './adapters/comment-real.adapter';
import { LiveBroadcaster } from './live.broadcaster';
import { WsAuthService } from './ws-auth.service';
import { LiveSessionsService } from './live-sessions.service';
import { ChatService } from './chat.service';
import { LiveCommentsService } from './live-comments.service';
import { CommentCollectorService } from './comment-collector.service';
import { LiveGateway } from './live.gateway';
import { LiveSessionsController } from './live-sessions.controller';
import { PublicLiveController } from './public-live.controller';

/**
 * SNS 댓글 소스 레지스트리 — 목이 배포 기본. 플랫폼 키(env) 존재 시에만 실 어댑터로 대체(격리 확장점).
 * 신규 시크릿 0(기존 YOUTUBE_·META_·X_·THREADS_ 키 재사용). meta 키는 fb·ig 두 플랫폼에 매핑.
 */
const registryProvider: Provider = {
  provide: COMMENT_SOURCE_REGISTRY,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): CommentSourceRegistry => {
    const registry = new CommentSourceRegistry();
    const youtubeKey = config.get('YOUTUBE_API_KEY', { infer: true });
    const metaToken = config.get('META_PAGE_ACCESS_TOKEN', { infer: true });
    const xToken = config.get('X_BEARER_TOKEN', { infer: true });
    const threadsToken = config.get('THREADS_ACCESS_TOKEN', { infer: true });

    registry.register(
      youtubeKey
        ? new RealCommentSourceAdapter(Platform.Youtube, youtubeKey)
        : new CommentMockAdapter(Platform.Youtube),
    );
    if (metaToken) {
      registry.register(new RealCommentSourceAdapter(Platform.Facebook, metaToken));
      registry.register(new RealCommentSourceAdapter(Platform.Instagram, metaToken));
    } else {
      registry.register(new CommentMockAdapter(Platform.Facebook));
      registry.register(new CommentMockAdapter(Platform.Instagram));
    }
    registry.register(
      xToken ? new RealCommentSourceAdapter(Platform.X, xToken) : new CommentMockAdapter(Platform.X),
    );
    registry.register(
      threadsToken
        ? new RealCommentSourceAdapter(Platform.Threads, threadsToken)
        : new CommentMockAdapter(Platform.Threads),
    );
    return registry;
  },
};

/**
 * 라이브 + WebSocket 모듈 — WS 게이트웨이·LiveSession REST·채팅·댓글수집.
 * DistributionCoreModule(ChannelAccountsService 재사용)만 import. 아무 모듈도 LiveModule을
 * import하지 않으므로 사이클 구조적 불가. PrismaService·JwtService·ConfigService는 전역 주입.
 */
@Module({
  imports: [DistributionCoreModule],
  controllers: [LiveSessionsController, PublicLiveController],
  providers: [
    registryProvider,
    LiveBroadcaster,
    WsAuthService,
    LiveSessionsService,
    ChatService,
    LiveCommentsService,
    CommentCollectorService,
    LiveGateway,
  ],
  exports: [LiveBroadcaster, LiveSessionsService],
})
export class LiveModule implements OnModuleDestroy {
  constructor(private readonly gateway: LiveGateway) {}

  /** graceful shutdown — socket.io Redis 어댑터 pub/sub 커넥션 정리(열린 핸들 방지) */
  async onModuleDestroy(): Promise<void> {
    await this.gateway.closeAdapters();
  }
}
