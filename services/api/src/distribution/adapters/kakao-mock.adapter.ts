import { Logger } from '@nestjs/common';
import type { Platform } from '@gachinol/shared';
import { Platform as PlatformEnum } from '@gachinol/shared';
import {
  ChannelPublishError,
  type ChannelAdapter,
  type ChannelPublishInput,
  type ChannelPublishOutput,
  type ChannelRetractInput,
} from './channel-adapter';

/**
 * 카카오톡 채널 목 어댑터 — 배포 기본(외부 네트워크 무접근·결정적 가짜 external ID/URL).
 * 테스트 제어: externalChannelId가 'fail-' 접두면 publish가 ChannelPublishError throw
 * (E2E 부분실패 경로를 외부 의존 없이 재현). retract는 no-op 성공.
 */
export class KakaoMockAdapter implements ChannelAdapter {
  readonly platform: Platform = PlatformEnum.Kakao;
  private readonly logger = new Logger(KakaoMockAdapter.name);

  publish(input: ChannelPublishInput): Promise<ChannelPublishOutput> {
    if (input.externalChannelId.startsWith('fail-')) {
      return Promise.reject(
        new ChannelPublishError(`카카오 목 송출 실패(결정적): ${input.externalChannelId}`),
      );
    }
    const externalPostId = `kakao_mock_${input.publicationId}`;
    const externalUrl = `https://pf.kakao.com/${input.externalChannelId}/${externalPostId}`;
    this.logger.debug(`카카오 목 송출 성공 publicationId=${input.publicationId}`);
    return Promise.resolve({ externalPostId, externalUrl });
  }

  retract(_input: ChannelRetractInput): Promise<void> {
    // 목: 회수 no-op 성공
    return Promise.resolve();
  }
}
