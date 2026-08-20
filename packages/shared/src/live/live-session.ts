import type {
  ChannelAccountId,
  ContentId,
  LiveSessionId,
  ProductId,
  StationId,
  UserId,
  WeeklyRecommendationId,
} from '../common/id';
import type { ISODateString, Timestamps } from '../common/time';
import type { ProductCard } from '../commerce/product-card';
import { ProgramCategory } from '../content/category';

export const LiveSessionStatus = {
  /** 편성됨 (토~일 정규) */
  Scheduled: 'scheduled',
  /** 인제스트 대기. ★ 긴급 라이브는 이 상태로 직접 생성 */
  Preparing: 'preparing',
  Live: 'live',
  /** 인제스트 끊김 등 장애 — 재개 또는 종료 */
  Interrupted: 'interrupted',
  /** [종결] VOD화는 vodContentId의 새 Content가 담당 */
  Ended: 'ended',
  /** [종결] */
  Canceled: 'canceled',
} as const;
export type LiveSessionStatus = (typeof LiveSessionStatus)[keyof typeof LiveSessionStatus];

export const LIVE_SESSION_STATUS_TRANSITIONS = {
  scheduled: ['preparing', 'canceled'],
  preparing: ['live', 'canceled'],
  live: ['interrupted', 'ended'],
  /** 스트림 재개 / 강제 종료 — 막다른 상태 아님 */
  interrupted: ['live', 'ended'],
  ended: [],
  canceled: [],
} as const satisfies Record<LiveSessionStatus, readonly LiveSessionStatus[]>;

/**
 * 진입점 규칙 — 긴급 여부 판정 기준은 type(ProgramCategory) 하나뿐이다:
 * 긴급(type='emergency')은 preparing으로 직접 생성, 그 외 정규 편성은 scheduled.
 * scheduledAt은 판정 기준이 아니다. 서버 검증 불변식: type='emergency' ⇔ scheduledAt=null —
 * 어긋난 조합(emergency+편성 시각, 비긴급+null)은 생성 요청 단계에서 거절한다.
 */
export const initialLiveStatus = (type: ProgramCategory): LiveSessionStatus =>
  type === ProgramCategory.Emergency ? LiveSessionStatus.Preparing : LiveSessionStatus.Scheduled;

export interface LiveSession extends Timestamps {
  id: LiveSessionId;
  /** 콘텐츠와 동일 6종 축 (news=주간뉴스 라이브) */
  type: ProgramCategory;
  title: string;
  description?: string;
  status: LiveSessionStatus;
  /** 주관국 — 정규 편성=센터, 긴급=현장 지사 */
  hostStationId: StationId;
  /** 진행 아나운서 (프롬프터 수신자) */
  announcerUserId: UserId | null;
  /** 편성 시각(토~일). 긴급(type='emergency')만 null — 불변식: type='emergency' ⇔ null (initialLiveStatus 참조) */
  scheduledAt: ISODateString | null;
  startedAt: ISODateString | null;
  endedAt: ISODateString | null;
  /** preparing 진입 시 발급 */
  rtmpIngestUrl: string | null;
  /** 시크릿 참조 키 — 값 비저장. 실제 값은 LiveIngestInfo로만 전달 */
  streamKeyRef: string | null;
  /** 구독자 앱 재생 URL. live 상태에서 존재 */
  hlsPlaybackUrl: string | null;
  /** fan-out '의도'. 채널별 송출 '결과'는 Publication(source.kind='live') 행이 담당 */
  targetChannelAccountIds: readonly ChannelAccountId[];
  /** type='news'(주간뉴스)의 소재 추천 링크 */
  weeklyRecommendationId: WeeklyRecommendationId | null;
  /**
   * ⚠️ **커머스 2단계(자체 결제)용이며 현재 아무도 채우지 않는다** — `products` 테이블이 없고
   * (Prisma `product_ids`는 `FK 없음(커머스 미도입)`) 이 id로 조회할 대상도 없다.
   * 1단계(링크아웃)가 쓰는 것은 아래 `productCards`다. 2단계 트리거 충족 시 되살린다.
   */
  productIds: readonly ProductId[];
  /**
   * type='live_commerce'의 외부 판매 채널 링크 카드 — **1단계(링크아웃)의 실사용 필드**.
   * 저장 위치는 `live_sessions.product_cards`(JSONB). 상세는 commerce/product-card.ts 주석.
   */
  productCards: readonly ProductCard[];
  /**
   * 종료 후 녹화본을 Content로 전환 시 연결.
   * 해당 Content는 origin='live_vod'·reporterId=null로 'uploaded' 상태 진입하며,
   * 기자 승인 게이트 없이 preview_generating → awaiting_center_review로 직행한다
   * (content/workflow.ts 전이 맵 참조).
   */
  vodContentId: ContentId | null;
  createdByUserId: UserId;
}

/**
 * 관제 전용 ingest 전달 DTO — 스트림키 값이 실리는 유일한 장소.
 * GET /live-sessions/:id/ingest (관제 권한) 응답 전용. 일반 LiveSession DTO에 절대 포함 금지.
 */
export interface LiveIngestInfo {
  liveSessionId: LiveSessionId;
  rtmpUrl: string;
  streamKey: string;
  expiresAt?: ISODateString;
}

/** 구독자 공개 투영 */
export interface LiveSessionPublic {
  id: LiveSessionId;
  type: ProgramCategory;
  title: string;
  status: LiveSessionStatus;
  scheduledAt: ISODateString | null;
  /** 엔티티(LiveSession.hlsPlaybackUrl)와 동일하게 부재를 null로 표현 — live 상태에서 non-null */
  hlsUrl: string | null;
  viewerCount: number;
  /**
   * 외부 판매 채널 링크 카드(1단계 링크아웃). live_commerce가 아니면 빈 배열.
   * **화이트리스트 투영이므로 여기 없으면 구독자 화면에 상품이 영영 뜨지 않는다** — 이 필드가
   * 없어서 T-W2-11의 상품 카드가 렌더할 데이터를 못 받는 상태였다(2026-08-21 착수 전 확인).
   */
  productCards: readonly ProductCard[];
}

/** 관제: 라이브 생성·편성 요청 */
export interface CreateLiveSessionRequest {
  type: ProgramCategory;
  title: string;
  /**
   * type='emergency'면 null 필수, 그 외에는 지정 필수 (서버 검증 불변식: type='emergency' ⇔ null).
   * 초기 상태 판정은 scheduledAt이 아니라 type만 사용한다 — initialLiveStatus 참조.
   */
  scheduledAt: ISODateString | null;
  /** 생략 시 센터 */
  hostStationId?: StationId;
  targetChannelAccountIds: readonly ChannelAccountId[];
  /** ⚠️ 2단계용·미구동(엔티티 주석 참조). 1단계는 아래 `productCards`를 쓴다 */
  productIds?: readonly ProductId[];
  /**
   * live_commerce 전용 — 외부 판매 채널 링크 카드.
   * `id`는 서버가 발급한다(관제는 나머지 4필드만 보낸다 — `ProductCardInput`).
   */
  productCards?: readonly ProductCardInput[];
}

/** 관제 입력 몫 — `id`는 서버 발급이라 클라이언트가 보내지 않는다 */
export type ProductCardInput = Omit<ProductCard, 'id'>;
