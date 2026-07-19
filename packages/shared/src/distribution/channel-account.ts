import type { ChannelAccountId, StationId } from '../common/id';
import type { ISODateString, Timestamps } from '../common/time';
import type { ChannelCapability, Platform } from './platform';

/**
 * 송출 채널 계정 — 지사별 카톡채널 12개 + 센터 SNS 계정들이 이 테이블의 행.
 * "지사당 채널 1개"는 현재의 우연이지 제약이 아니다.
 */
export const ChannelAccountStatus = {
  Connected: 'connected',
  /** 토큰 만료 — 재연결 필요 */
  Expired: 'expired',
  /** 권한 회수됨 */
  Revoked: 'revoked',
  /** 운영자 비활성 */
  Disabled: 'disabled',
} as const;
export type ChannelAccountStatus = (typeof ChannelAccountStatus)[keyof typeof ChannelAccountStatus];

export interface ChannelAccount extends Timestamps {
  id: ChannelAccountId;
  platform: Platform;
  /** 지사 소유 채널이면 지사 id. null = 센터 공용 (SNS 라이브 계정) */
  stationId: StationId | null;
  /** 예: '애월 마을방송국 카카오톡 채널' */
  name: string;
  /** 플랫폼 측 채널/페이지 ID. (platform, externalChannelId) unique */
  externalChannelId: string;
  /** 시크릿 저장소의 키 이름만 — 토큰 값 저장 금지 */
  credentialRef: string;
  capabilities: readonly ChannelCapability[];
  status: ChannelAccountStatus;
  connectedAt?: ISODateString;
  expiresAt?: ISODateString;
}
