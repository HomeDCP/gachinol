import type { ChatMessageId, LiveSessionId, UserId } from '../common/id';
import type { ISODateString } from '../common/time';

/**
 * 구독자 앱 자체 채팅.
 * 조회: (liveSessionId, sentAt DESC) + UUID v7 커서. offset 금지(고빈도 insert).
 */
export const ChatVisibility = {
  Visible: 'visible',
  Hidden: 'hidden',
} as const;
export type ChatVisibility = (typeof ChatVisibility)[keyof typeof ChatVisibility];

export interface ChatMessage {
  id: ChatMessageId;
  liveSessionId: LiveSessionId;
  userId: UserId;
  /** 표시용 비정규화 */
  userName: string;
  message: string;
  /** 모더레이션 — hidden도 행 보존(soft), 신고 감사 대응 */
  visibility: ChatVisibility;
  moderatedByUserId: UserId | null;
  sentAt: ISODateString;
}
