import type { Brand } from './brand';

/**
 * 모든 엔티티 ID는 브랜디드 문자열.
 * 값은 서버가 발급하는 UUID v7(시간순 정렬 가능) 권장 — id 자체를 커서 페이지네이션의 커서로 쓸 수 있다.
 */
export type StationId = Brand<string, 'StationId'>;
export type UserId = Brand<string, 'UserId'>;
export type CommunityFigureId = Brand<string, 'CommunityFigureId'>;
export type ContentId = Brand<string, 'ContentId'>;
export type SceneId = Brand<string, 'SceneId'>;
export type RevisionRequestId = Brand<string, 'RevisionRequestId'>;
export type MediaAssetId = Brand<string, 'MediaAssetId'>;
export type JobId = Brand<string, 'JobId'>;
export type AiAnalysisId = Brand<string, 'AiAnalysisId'>;
export type WeeklyRecommendationId = Brand<string, 'WeeklyRecommendationId'>;
export type ChannelAccountId = Brand<string, 'ChannelAccountId'>;
export type PublicationId = Brand<string, 'PublicationId'>;
export type LiveSessionId = Brand<string, 'LiveSessionId'>;
export type LiveCommentId = Brand<string, 'LiveCommentId'>;
export type ChatMessageId = Brand<string, 'ChatMessageId'>;
export type ProductId = Brand<string, 'ProductId'>;
/** 라이브커머스 1단계(링크아웃) 카드 — `ProductId`와 별개다(commerce/product-card.ts 주석 참조) */
export type ProductCardId = Brand<string, 'ProductCardId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type MediaSaleId = Brand<string, 'MediaSaleId'>;
export type ForecastId = Brand<string, 'ForecastId'>;
export type StatusTransitionLogId = Brand<string, 'StatusTransitionLogId'>;

/** 경계(DB row → 엔티티, JSON 파싱)에서만 쓰는 캐스팅 헬퍼. 사용: toId<StationId>(row.id) */
export const toId = <T extends Brand<string, string>>(raw: string): T => raw as T;
