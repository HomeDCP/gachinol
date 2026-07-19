import type { ChannelAccountId, LiveCommentId, LiveSessionId } from '../common/id';
import type { ISODateString } from '../common/time';
import type { Platform } from '../distribution/platform';

/** 외부 채널 댓글 → 프롬프터 */
export const LiveCommentStatus = {
  /** 수집·정규화 완료 */
  Collected: 'collected',
  /** 프롬프터 노출됨 */
  Prompted: 'prompted',
  /** 필터링(욕설 등)·수동 숨김 */
  Hidden: 'hidden',
} as const;
export type LiveCommentStatus = (typeof LiveCommentStatus)[keyof typeof LiveCommentStatus];

export interface LiveComment {
  id: LiveCommentId;
  liveSessionId: LiveSessionId;
  channelAccountId: ChannelAccountId;
  /** 수집 플랫폼 비정규화 — 프롬프터 플랫폼 뱃지 (SNS 5종에서만 발생, 제약은 서버 검증) */
  platform: Platform;
  /** (channelAccountId, externalCommentId) unique — 중복 수집 dedup을 DB가 보장 */
  externalCommentId: string;
  authorName: string;
  authorExternalId?: string;
  authorAvatarUrl?: string;
  /** 정규화된 본문 (프롬프터 표시용) */
  message: string;
  /** 질문 여부 — 아나운서 우선 응답 후보 */
  isQuestion?: boolean;
  status: LiveCommentStatus;
  /** 플랫폼상 작성 시각 */
  postedAt: ISODateString;
  /** 수집 시각 */
  collectedAt: ISODateString;
  promptedAt?: ISODateString;
}
