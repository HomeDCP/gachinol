import { Logger } from '@nestjs/common';
import type { Platform } from '@gachinol/shared';
import type { ChannelAdapter } from './channel-adapter';

/**
 * platform → ChannelAdapter 레지스트리. 워커가 publication.platform으로 조회한다.
 * 이번 슬라이스는 kakao 1개(목 기본 / KAKAO_* 시 실). 미등록 플랫폼은 undefined →
 * 워커가 해당 Publication을 failed('지원하지 않는 플랫폼')로 흡수(부분실패).
 */
export class ChannelAdapterRegistry {
  private readonly logger = new Logger(ChannelAdapterRegistry.name);
  private readonly adapters = new Map<Platform, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.platform, adapter);
    this.logger.log(`채널 어댑터 등록: ${adapter.platform} (${adapter.constructor.name})`);
  }

  get(platform: string): ChannelAdapter | undefined {
    return this.adapters.get(platform as Platform);
  }
}
