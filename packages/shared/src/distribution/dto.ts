import type { ChannelAccountId } from '../common/id';

/**
 * POST /v1/contents/:id/distribute — 대상 채널 명시 override.
 * 생략 시 서버가 해석: content.targetChannelAccountIds → 소속 지사의 connected kakao(vod_publish) 채널.
 * control-center 앱이 ad-hoc 대상 지정 시 계약 단일화 (응답·나머지 송출 3종은 기존 Publication 소비).
 */
export interface DistributeContentRequest {
  channelAccountIds?: readonly ChannelAccountId[];
}
