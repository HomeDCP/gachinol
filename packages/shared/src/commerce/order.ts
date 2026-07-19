import type { LiveSessionId, OrderId, ProductId, UserId } from '../common/id';
import type { Krw } from '../common/money';
import type { ISODateString, Timestamps } from '../common/time';

/**
 * 주문 — MVP 범위는 결제까지 (배송 축은 PG·물류 확정 후 fulfillmentStatus 별도 축으로 추가 —
 * 결제 축을 오염시키지 않는다). 아이템은 주문 시점 스냅샷 — 이후 상품 수정이 과거 주문을
 * 바꾸지 못하게 하는 감사 요건. 배송 주소는 개인정보 — shared 계약에서 제외.
 */
export const PaymentStatus = {
  /** PG 결제창 진입 */
  Pending: 'pending',
  Paid: 'paid',
  Failed: 'failed',
  /** 결제 전 취소 [종결] */
  Canceled: 'canceled',
  /** [종결] */
  Refunded: 'refunded',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PAYMENT_STATUS_TRANSITIONS = {
  pending: ['paid', 'failed', 'canceled'],
  /** 재결제 시도 / 포기 */
  failed: ['pending', 'canceled'],
  paid: ['refunded'],
  canceled: [],
  refunded: [],
} as const satisfies Record<PaymentStatus, readonly PaymentStatus[]>;

/** 주문 시점 스냅샷 — 상품명·단가 복사 */
export interface OrderItem {
  productId: ProductId;
  productName: string;
  unitPriceKrw: Krw;
  quantity: number;
}

export interface Order extends Timestamps {
  id: OrderId;
  buyerUserId: UserId;
  /** 라이브 중 구매 귀속 (커머스 성과 측정·구매 이벤트 오버레이). 비라이브 구매는 null */
  liveSessionId: LiveSessionId | null;
  /** MVP는 1개일 수 있으나 계약은 N개. DB는 order_items 테이블 */
  items: readonly OrderItem[];
  /** items 합계 스냅샷 */
  totalKrw: Krw;
  paymentStatus: PaymentStatus;
  /** PG사 미정 — 자유 문자열 */
  pgProvider?: string;
  pgTransactionId?: string;
  orderedAt: ISODateString;
  paidAt: ISODateString | null;
  canceledAt: ISODateString | null;
  refundedAt: ISODateString | null;
}

/** 구독자: 주문 생성 */
export interface CreateOrderRequest {
  productId: ProductId;
  quantity: number;
  liveSessionId?: LiveSessionId;
}

/** PG 확정 전 최소 계약 — 결제창 진입 정보 */
export interface PaymentInit {
  orderId: OrderId;
  pgProvider: string;
  /** 웹뷰로 여는 결제창 (SDK형 PG 확정 시 계약 변경) */
  checkoutUrl: string;
}
