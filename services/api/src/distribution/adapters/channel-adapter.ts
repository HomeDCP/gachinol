import type { Platform } from '@gachinol/shared';
import type { PublishTargetItem } from '../distribution-job';

/** 어댑터가 채널에 게시할 입력 = 큐 wire의 PublishTargetItem (좌표+메시지) */
export type ChannelPublishInput = PublishTargetItem;

export interface ChannelPublishOutput {
  externalPostId: string;
  externalUrl: string;
}

export interface ChannelRetractInput {
  externalChannelId: string;
  externalPostId: string;
  credentialRef: string;
}

/**
 * 채널 어댑터 — 플랫폼별 송출/회수의 격리 경계. 워커(DB 무접근)가 이 인터페이스만 호출한다.
 * 카카오는 목이 배포 기본, 실 제공자는 KAKAO_* env 게이트 확장점(kakao-real.adapter).
 */
export interface ChannelAdapter {
  readonly platform: Platform;
  publish(input: ChannelPublishInput): Promise<ChannelPublishOutput>;
  retract(input: ChannelRetractInput): Promise<void>;
}

/** 채널 송출 실패 — 워커가 채널 단위 결과(ok:false)로 흡수한다(잡 throw 아님) */
export class ChannelPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelPublishError';
  }
}
