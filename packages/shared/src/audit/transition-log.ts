import type { JobId, StatusTransitionLogId, UserId } from '../common/id';
import type { ISODateString } from '../common/time';

/**
 * 모든 상태머신 전이의 구조화 기록. "누가 언제 승인·반려·수정했는가"의 답.
 * (Job 전이는 고빈도 노이즈라 제외 — BullMQ 자체 이력 활용.)
 * 조회 인덱스: (entity_type, entity_id, at DESC) — 상세 화면 "이력" 탭.
 */
export const TransitionEntityType = {
  Content: 'content',
  WeeklyRecommendation: 'weekly_recommendation',
  LiveSession: 'live_session',
  Publication: 'publication',
  Order: 'order',
  MediaSale: 'media_sale',
  /** 지사 상태 전이 — dormant→operating '부활'(MVP: 애월·제주시)의 "누가 언제" 기록 */
  Station: 'station',
  /** 커머스 상품 상태 전이 (on_sale↔sold_out·discontinued 등) */
  Product: 'product',
} as const;
export type TransitionEntityType = (typeof TransitionEntityType)[keyof typeof TransitionEntityType];

export const ActorType = {
  User: 'user',
  System: 'system',
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];

export interface StatusTransitionLog {
  id: StatusTransitionLogId;
  entityType: TransitionEntityType;
  /** 다형 참조 — 도메인별 조회 헬퍼가 좁힌다 */
  entityId: string;
  fromStatus: string;
  toStatus: string;
  actorType: ActorType;
  /** actorType='user'일 때 필수 (서버 불변식) */
  actorUserId: UserId | null;
  /** 시스템 전이를 일으킨 작업 */
  jobId: JobId | null;
  /** 반려 사유·수정 지시 요약 등 */
  note?: string;
  at: ISODateString;
}
