import type {
  ChannelAccountId,
  ContentId,
  LiveSessionId,
  PublicationId,
  UserId,
} from '../common/id';
import type { ISODateString } from '../common/time';
import type { Platform } from './platform';

/**
 * 송출 기록: (소스 × 채널) 1건. 재송출은 새 행(이력 보존·감사 대응).
 * Content 상태(publishing/publish_failed)와 독립된 채널 단위 상태머신 —
 * 일부 채널 실패는 채널 단위 재시도로 복구.
 * Content publishing → published 판정: "필수 채널 Publication 전부 published"
 * (성공 판정 정책 상세는 서버 소관).
 */
export const PublicationStatus = {
  Queued: 'queued',
  Publishing: 'publishing',
  Published: 'published',
  Failed: 'failed',
  /** 송출 후 회수·삭제 [종결] */
  Retracted: 'retracted',
  /** [종결] */
  Canceled: 'canceled',
} as const;
export type PublicationStatus = (typeof PublicationStatus)[keyof typeof PublicationStatus];

export const PUBLICATION_STATUS_TRANSITIONS = {
  queued: ['publishing', 'canceled'],
  publishing: ['published', 'failed'],
  /** 채널 단위 재시도 — Content.publish_failed와 독립 */
  failed: ['queued', 'canceled'],
  published: ['retracted'],
  retracted: [],
  canceled: [],
} as const satisfies Record<PublicationStatus, readonly PublicationStatus[]>;

/** 소스 XOR을 판별 유니언으로 표현 */
export type PublicationSource =
  { kind: 'content'; contentId: ContentId } | { kind: 'live'; liveSessionId: LiveSessionId };

export interface Publication {
  id: PublicationId;
  source: PublicationSource;
  channelAccountId: ChannelAccountId;
  /** 조회 편의 비정규화 */
  platform: Platform;
  status: PublicationStatus;
  /** 플랫폼 측 게시물/영상 ID */
  externalPostId?: string;
  /** 외부 시청 URL */
  externalUrl?: string;
  attempts: number;
  errorMessage?: string;
  /** null = 시스템 자동 송출 */
  requestedByUserId: UserId | null;
  queuedAt: ISODateString;
  publishedAt: ISODateString | null;
  retractedAt: ISODateString | null;
}
