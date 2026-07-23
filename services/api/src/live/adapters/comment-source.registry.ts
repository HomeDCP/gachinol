import { Logger } from '@nestjs/common';
import type { Platform } from '@gachinol/shared';
import type { CommentSourceAdapter } from './comment-source.adapter';

/**
 * platform → CommentSourceAdapter 레지스트리(ChannelAdapterRegistry 동형).
 * 수집기가 채널 platform으로 조회. 미등록 플랫폼(=kakao/app 등 댓글수집 비대상)은 undefined →
 * 수집기가 해당 채널을 조용히 건너뜀(per-channel skip).
 */
export class CommentSourceRegistry {
  private readonly logger = new Logger(CommentSourceRegistry.name);
  private readonly adapters = new Map<Platform, CommentSourceAdapter>();

  register(adapter: CommentSourceAdapter): void {
    this.adapters.set(adapter.platform, adapter);
    this.logger.log(`댓글 소스 어댑터 등록: ${adapter.platform} (${adapter.constructor.name})`);
  }

  get(platform: string): CommentSourceAdapter | undefined {
    return this.adapters.get(platform as Platform);
  }
}
