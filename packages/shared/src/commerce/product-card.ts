import type { ProductCardId } from '../common/id';

/* ══════════════════════════════════════════════════════════════════════════
 * 라이브커머스 **1단계(링크아웃)** 상품 카드 — 표시용 최소 정보. shared 단일 원천.
 *
 * ★ 왜 `Product`(commerce/product.ts)가 아니라 별도 타입인가
 *   `Product`는 가격(`Krw`)·재고(`stockQty`)·상태머신(`PRODUCT_STATUS_TRANSITIONS`)을 가진
 *   **2단계(자체 결제)용 계약**이고, 정작 링크아웃의 본체인 **외부 판매 URL 필드가 없다**.
 *   1단계에서 그 타입을 쓰면 우리가 보관하지 않기로 한 데이터를 타입이 요구하게 된다.
 *   정본 05 §A-1: "구현 범위는 **상품 카드 + 외부 링크 + 클릭 계측, 이 3건뿐**이며 …
 *   가치놀은 **상품·주문·결제 데이터를 보관·처리하지 않는다**."
 *   ⇒ `Product`·`Order`는 2단계 트리거(링크아웃 GMV 월 300만원 3개월) 충족 시 되살린다.
 *
 * ★ `priceLabel`이 숫자가 아니라 문자열인 이유 (의도적 제약)
 *   우리는 가격을 계산·비교·정산하지 않는다. `Krw` 숫자로 두면 언젠가 합계·수수료·정산을 내려는
 *   코드가 생기고, **그 순간 거래 당사자성이 발생**한다(05 §A-1 6번 — 통신판매업 신고 의무가
 *   1단계에도 적용되는지는 07 판정 대기 중이다). 표시용이라는 것을 타입으로 못박는다.
 *   `"25,000원"`·`"3kg 35,000원~"`처럼 판매자 표기를 그대로 옮긴다.
 *
 * ★ `id`가 있는 이유 (사용자 승인 스케치에는 없던 필드)
 *   클릭 계측의 상관자다. 배열 인덱스로 식별하면 **관제가 카드 순서를 바꾸는 순간 과거 지표가
 *   다른 상품에 붙는다**(집계는 시간을 거슬러 정정되지 않는다). 카드 추가 시 발급하는 UUID v7.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 라이브 세션에 붙는 외부 판매 채널 링크 카드.
 * 저장 위치는 `live_sessions.product_cards`(JSONB) — 별도 테이블을 만들지 않는 것이 요점이다.
 */
export interface ProductCard {
  id: ProductCardId;
  /** 상품명 — 판매자 표기 그대로 */
  name: string;
  /** 외부 판매 채널 URL(네이버 스마트스토어 등). `isSafeLinkoutUrl`을 통과한 값만 저장한다 */
  url: string;
  /** 카드 썸네일. 외부 CDN URL 허용 — 우리가 이미지를 보관하지 않는다 */
  imageUrl?: string;
  /** **표시용 문자열**(위 주석 참조). 숫자로 바꾸지 말 것 */
  priceLabel?: string;
}

/** 세션당 카드 상한 — 라이브 화면에서 스크롤 없이 훑을 수 있는 규모 */
export const MAX_PRODUCT_CARDS_PER_SESSION = 20;

export const PRODUCT_CARD_NAME_MAX = 100;
export const PRODUCT_CARD_URL_MAX = 2048;
export const PRODUCT_CARD_PRICE_LABEL_MAX = 40;

/**
 * 링크아웃 URL 허용 판정 — **http/https만**.
 *
 * ⚠️ 이 함수가 없으면 `javascript:`·`data:` URL이 카드에 실려 구독자 웹에서 실행된다(저장형 XSS).
 * 입력 주체가 센터 운영자라 해도 계정 탈취 한 번이면 공개 화면 전체가 대상이 되므로 **저장 경계에서** 막는다.
 *
 * T-W1-09가 세운 원칙과 같다 — **"열 수 없는 값"도 없음과 동일 취급**(스킴 없는 문자열은 죽은 링크다).
 * 클라이언트와 서버가 같은 규칙을 쓰도록 shared에 둔다(런타임 의존성 0 규약이라 순수 함수).
 */
export function isSafeLinkoutUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > PRODUCT_CARD_URL_MAX) {
    return false;
  }
  return LINKOUT_URL_RE.test(value);
}

/**
 * `http(s)://` + 호스트 1자 이상 + 공백·꺾쇠·따옴표·역슬래시 없음.
 *
 * ⚠️ **`new URL()`을 쓰지 않는 것은 의도다** — shared는 런타임 의존성 0·환경 중립이 규약이라
 * `lib.dom`이 없고(빌드가 `TS2304: Cannot find name 'URL'`로 실제로 깨졌다), Node·브라우저·RN의
 * `URL` 구현 차이에 판정을 맡기고 싶지도 않다. 여기서 막으려는 것은 `javascript:`·`data:` 스킴이며
 * **선두 스킴 고정만으로 충분**하다(`javascript:...//https://` 같은 우회는 선두가 http(s)가 아니라 탈락).
 * 정규화·리다이렉트 추적은 이 함수의 책임이 아니다 — 최종 이동은 브라우저가 한다.
 */
const LINKOUT_URL_RE = /^https?:\/\/[^\s<>"'\\]+$/i;
