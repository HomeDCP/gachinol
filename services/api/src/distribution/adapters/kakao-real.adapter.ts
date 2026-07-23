import { Logger } from '@nestjs/common';
import type { Platform } from '@gachinol/shared';
import { Platform as PlatformEnum } from '@gachinol/shared';
import {
  type ChannelAdapter,
  type ChannelPublishInput,
  type ChannelPublishOutput,
  type ChannelRetractInput,
} from './channel-adapter';

/**
 * 카카오톡 채널 실 어댑터 — KAKAO_REST_API_KEY && KAKAO_CHANNEL_ADMIN_KEY 둘 다 설정 시에만
 * 레지스트리가 주입한다(아니면 목). 카카오 채널 메시지 API는 채널 심사·계약 확정 필요 →
 * 이번 슬라이스는 스켈레톤: credentialRef로 시크릿 저장소 조회 후 HTTP 호출하는 '자리'만 두고
 * 미구현 경로는 명시 throw(목이 배포 기본이라 무영향). AiWorkerClient의 fetch+timeout 패턴 재사용,
 * in-call 재시도 없음(재시도는 잡 attempts·재시도 엔드포인트의 몫).
 */
export class KakaoRealAdapter implements ChannelAdapter {
  readonly platform: Platform = PlatformEnum.Kakao;
  private readonly logger = new Logger(KakaoRealAdapter.name);

  constructor(
    private readonly restApiKey: string,
    private readonly channelAdminKey: string,
    private readonly timeoutMs: number,
  ) {}

  publish(_input: ChannelPublishInput): Promise<ChannelPublishOutput> {
    // TODO(카카오 채널 심사·메시지 API 확정 후): credentialRef → 시크릿 저장소 액세스 토큰 조회 →
    // fetch(`https://kapi.kakao.com/...`, { headers: { Authorization: `KakaoAK ${restApiKey}` },
    //   signal: AbortSignal.timeout(this.timeoutMs) }) → externalPostId/URL 매핑.
    this.logger.warn('KakaoRealAdapter.publish 미구현 — KAKAO_* 설정됐으나 실 송출 경로 부재');
    throw new Error('KakaoRealAdapter.publish 미구현 (카카오 채널 메시지 API 확정 후 구현)');
  }

  retract(_input: ChannelRetractInput): Promise<void> {
    this.logger.warn('KakaoRealAdapter.retract 미구현');
    throw new Error('KakaoRealAdapter.retract 미구현 (카카오 채널 메시지 API 확정 후 구현)');
  }
}
