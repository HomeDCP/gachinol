import type { Platform } from '@gachinol/shared';

/** 어댑터가 산출하는 정규화 전 원시 댓글 — postedAt은 ISO 문자열 */
export interface RawComment {
  externalCommentId: string;
  authorName: string;
  authorExternalId?: string;
  authorAvatarUrl?: string;
  message: string;
  isQuestion?: boolean;
  postedAt: string;
}

export interface CommentPollInput {
  externalChannelId: string;
  /** 시크릿 저장소 키 이름만(값 아님) */
  credentialRef: string;
  /** 라이브 방송의 플랫폼 측 식별자(YouTube liveChatId 등) — 있으면 사용 */
  liveExternalId?: string;
  /** 지난 poll의 nextCursor — 이 이후 신규만 */
  sinceCursor?: string;
}

export interface CommentPollResult {
  comments: readonly RawComment[];
  nextCursor?: string;
}

/**
 * SNS 채널 댓글 소스 어댑터 — 폴링 계약(웹훅은 이 뒤 확장점). 목이 배포 기본,
 * 실 어댑터는 플랫폼 키(env) 존재 시에만 레지스트리에 등록(distribution.module 팩토리 선례).
 * api=유일 DB 기록자이므로 어댑터는 순수 fetch(무DB·무큐).
 */
export interface CommentSourceAdapter {
  readonly platform: Platform;
  poll(input: CommentPollInput): Promise<CommentPollResult>;
}
