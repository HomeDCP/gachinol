import type { ApiError } from '../common/api-error';
import type {
  ChatMessageId,
  ContentId,
  LiveSessionId,
  OrderId,
  ProductId,
  PublicationId,
  StationId,
  WeeklyRecommendationId,
} from '../common/id';
import type { Krw } from '../common/money';
import type { ISODateOnlyString, ISODateString } from '../common/time';
import type { ContentStatus } from '../content/workflow';
import type { Platform } from '../distribution/platform';
import type { PublicationSource, PublicationStatus } from '../distribution/publication';
import type { JobType } from '../job/job';
import type { ChatMessage, ChatVisibility } from '../live/chat-message';
import type { LiveComment } from '../live/live-comment';
import type { LiveSessionPublic, LiveSessionStatus } from '../live/live-session';
import type { ProductStatus } from '../commerce/product';
import type { RecommendationStatus } from '../recommendation/weekly-recommendation';

/**
 * 실시간(WebSocket) 계약.
 * socket.io 채택 시 ServerEventPayloads를 EmitEvents로 매핑, 순수 ws여도 ServerEvent 유니언으로 파싱 —
 * shared는 어느 구현에도 의존하지 않는다.
 */

// ── Server → Client 페이로드 ──────────────────────────────────────

export interface ContentStatusChangedPayload {
  contentId: ContentId;
  stationId: StationId;
  from: ContentStatus;
  to: ContentStatus;
  at: ISODateString;
}

/** 고빈도 — 스로틀 서버 소관 */
export interface ContentProgressPayload {
  contentId: ContentId;
  status: ContentStatus;
  jobType: JobType;
  /** 0~100 */
  progress: number;
}

export interface RecommendationUpdatedPayload {
  recommendationId: WeeklyRecommendationId;
  weekOf: ISODateOnlyString;
  status: RecommendationStatus;
  generation: number;
}

export interface PublicationUpdatedPayload {
  publicationId: PublicationId;
  source: PublicationSource;
  platform: Platform;
  status: PublicationStatus;
  externalUrl?: string;
}

export interface LiveStatusChangedPayload {
  liveSessionId: LiveSessionId;
  from: LiveSessionStatus;
  to: LiveSessionStatus;
  at: ISODateString;
}

export interface LiveViewerCountPayload {
  liveSessionId: LiveSessionId;
  total: number;
  byPlatform?: Partial<Record<Platform, number>>;
}

export interface ChatModeratedPayload {
  liveSessionId: LiveSessionId;
  chatMessageId: ChatMessageId;
  visibility: ChatVisibility;
}

/** 폴링 수집 특성상 배치 전달 */
export interface PrompterCommentsPayload {
  liveSessionId: LiveSessionId;
  /** postedAt 오름차순 */
  comments: readonly LiveComment[];
}

/** 구매 이벤트 오버레이·매출 집계 (구매자명 비포함 — 개인정보) */
export interface OrderPaidPayload {
  liveSessionId: LiveSessionId | null;
  orderId: OrderId;
  productIds: readonly ProductId[];
  totalKrw: Krw;
}

export interface StockChangedPayload {
  productId: ProductId;
  stockQty: number | null;
  status: ProductStatus;
}

// ── 타입 맵 (게이트웨이·클라이언트가 공유하는 계약의 본체) ──────────

export interface ServerEventPayloads {
  'content.status_changed': ContentStatusChangedPayload;
  'content.progress': ContentProgressPayload;
  'recommendation.updated': RecommendationUpdatedPayload;
  'publication.updated': PublicationUpdatedPayload;
  'live.status_changed': LiveStatusChangedPayload;
  'live.viewer_count': LiveViewerCountPayload;
  'chat.new': ChatMessage;
  'chat.moderated': ChatModeratedPayload;
  'prompter.comments': PrompterCommentsPayload;
  'commerce.order_paid': OrderPaidPayload;
  'commerce.stock_changed': StockChangedPayload;
}
export type ServerEventName = keyof ServerEventPayloads;

/** 로깅·리플레이용 판별 유니언 */
export type ServerEvent = {
  [K in ServerEventName]: { event: K; payload: ServerEventPayloads[K] };
}[ServerEventName];

// ── Client → Server (+ack) ───────────────────────────────────────

export interface ClientEventPayloads {
  'live.join': { liveSessionId: LiveSessionId };
  'live.leave': { liveSessionId: LiveSessionId };
  'chat.send': { liveSessionId: LiveSessionId; message: string };
  'prompter.join': { liveSessionId: LiveSessionId };
  'control.join': Record<string, never>;
}
export type ClientEventName = keyof ClientEventPayloads;

/** WS ack 공용 — 실패는 ApiError. 이벤트별 T는 ClientEventAcks가 결정 */
export type WsAck<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface LiveJoinAck {
  session: LiveSessionPublic;
  /** 최근 N개 */
  recentChat: readonly ChatMessage[];
}

export interface PrompterJoinAck {
  /** 접속 시점 초기 배치 (postedAt 오름차순) — 이후 증분은 'prompter.comments' 이벤트로 수신 */
  recentComments: readonly LiveComment[];
}

/**
 * 클라이언트 이벤트 → ack 데이터 타입 맵 (요청은 ClientEventPayloads, 응답은 이 맵 — 계약 완결).
 * 게이트웨이·클라이언트는 이벤트 E의 응답을 WsAck<ClientEventAcks[E]>로 좁힌다.
 * socket.io 채택 시 ClientToServerEvents의 ack 콜백 타입 원천.
 */
export interface ClientEventAcks {
  'live.join': LiveJoinAck;
  /** 성공 여부만 의미 — 데이터 없음 */
  'live.leave': null;
  /** 저장·검열 반영된 메시지 ('chat.new' 브로드캐스트와 동일 개체) */
  'chat.send': ChatMessage;
  'prompter.join': PrompterJoinAck;
  /** 성공 여부만 의미 — 데이터 없음 */
  'control.join': null;
}
// 키 정합 검증 — ClientEventPayloads의 모든 이벤트는 ack 타입을 가진다
type _AssertAckComplete = ClientEventAcks[ClientEventName];
