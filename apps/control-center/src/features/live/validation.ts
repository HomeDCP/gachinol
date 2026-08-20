import {
  isSafeLinkoutUrl,
  MAX_PRODUCT_CARDS_PER_SESSION,
  PRODUCT_CARD_NAME_MAX,
  PRODUCT_CARD_PRICE_LABEL_MAX,
  ProgramCategory,
} from '@gachinol/shared';
import type {
  ChannelAccountId,
  CreateLiveSessionRequest,
  ProductCardInput,
  ProgramCategory as Category,
} from '@gachinol/shared';

/**
 * 라이브 생성 폼 검증 — shared 불변식(type='emergency' ⇔ scheduledAt=null)을 클라에서 사전 강제한다.
 * 서버가 최종 판정하지만(400 validation_failed) 어긋난 요청을 아예 막아 왕복을 줄인다.
 */

export const TITLE_MAX_LEN = 200;

export interface CreateLiveSessionInput {
  type: Category;
  title: string;
  /** ISO datetime 또는 null(긴급) */
  scheduledAt: string | null;
  targetChannelAccountIds: readonly ChannelAccountId[];
  /** live_commerce 전용 — 비어 있는 행(사용자가 추가만 하고 안 채운 것)은 제출 전에 걸러진다 */
  productCards?: readonly ProductCardDraft[];
}

/** 폼 입력 상태 — 전부 문자열이며 빈 문자열은 "미입력"이다 */
export interface ProductCardDraft {
  name: string;
  url: string;
  imageUrl: string;
  priceLabel: string;
}

export const emptyProductCardDraft = (): ProductCardDraft => ({
  name: '',
  url: '',
  imageUrl: '',
  priceLabel: '',
});

/** 네 칸이 모두 비었으면 "사용자가 추가만 하고 안 채운 행" — 오류가 아니라 무시 대상이다 */
export const isBlankProductCard = (d: ProductCardDraft): boolean =>
  d.name.trim() === '' && d.url.trim() === '' && d.imageUrl.trim() === '' && d.priceLabel.trim() === '';

export interface CreateLiveSessionErrors {
  title?: string;
  scheduledAt?: string;
  /** 카드 인덱스 → 메시지. 어느 행이 틀렸는지 화면에서 짚어주기 위해 인덱스를 키로 쓴다 */
  productCards?: Record<number, string>;
}

export interface CreateLiveSessionValidation {
  ok: boolean;
  errors: CreateLiveSessionErrors;
  /** ok일 때만 — 서버로 보낼 요청 */
  request?: CreateLiveSessionRequest;
}

function isValidDateTime(iso: string): boolean {
  return !Number.isNaN(new Date(iso).getTime());
}

export function validateCreateLiveSession(
  input: CreateLiveSessionInput,
): CreateLiveSessionValidation {
  const errors: CreateLiveSessionErrors = {};
  const title = input.title.trim();
  const isEmergency = input.type === ProgramCategory.Emergency;

  if (title.length === 0) {
    errors.title = '제목을 입력하세요';
  } else if (title.length > TITLE_MAX_LEN) {
    errors.title = `제목은 ${TITLE_MAX_LEN}자를 넘을 수 없습니다`;
  }

  if (isEmergency) {
    // 긴급 ⇔ scheduledAt=null
    if (input.scheduledAt !== null) {
      errors.scheduledAt = '긴급 라이브는 편성 시각을 지정할 수 없습니다';
    }
  } else {
    if (input.scheduledAt === null || input.scheduledAt.trim().length === 0) {
      errors.scheduledAt = '편성 시각을 지정하세요';
    } else if (!isValidDateTime(input.scheduledAt)) {
      errors.scheduledAt = '편성 시각 형식이 올바르지 않습니다';
    }
  }

  // 라이브커머스 상품 카드(1단계 링크아웃). 다른 유형에서는 입력 자체가 노출되지 않는다.
  const filled = (input.productCards ?? []).filter((d) => !isBlankProductCard(d));
  const cardErrors: Record<number, string> = {};
  const productCards: ProductCardInput[] = [];

  if (filled.length > MAX_PRODUCT_CARDS_PER_SESSION) {
    cardErrors[MAX_PRODUCT_CARDS_PER_SESSION] = `상품은 최대 ${MAX_PRODUCT_CARDS_PER_SESSION}개까지 등록할 수 있습니다`;
  }

  filled.forEach((draft, i) => {
    const name = draft.name.trim();
    const url = draft.url.trim();
    const imageUrl = draft.imageUrl.trim();
    const priceLabel = draft.priceLabel.trim();

    if (name.length === 0) {
      cardErrors[i] = '상품명을 입력하세요';
    } else if (name.length > PRODUCT_CARD_NAME_MAX) {
      cardErrors[i] = `상품명은 ${PRODUCT_CARD_NAME_MAX}자를 넘을 수 없습니다`;
    } else if (!isSafeLinkoutUrl(url)) {
      // 서버·구독자 앱과 같은 shared 규칙이다(사본 아님) — 세 곳이 어긋날 수 없다
      cardErrors[i] = '판매 링크는 http:// 또는 https:// 로 시작해야 합니다';
    } else if (imageUrl.length > 0 && !isSafeLinkoutUrl(imageUrl)) {
      cardErrors[i] = '이미지 주소는 http:// 또는 https:// 로 시작해야 합니다';
    } else if (priceLabel.length > PRODUCT_CARD_PRICE_LABEL_MAX) {
      cardErrors[i] = `가격 표기는 ${PRODUCT_CARD_PRICE_LABEL_MAX}자를 넘을 수 없습니다`;
    } else {
      productCards.push({
        name,
        url,
        ...(imageUrl.length > 0 ? { imageUrl } : {}),
        ...(priceLabel.length > 0 ? { priceLabel } : {}),
      });
    }
  });

  if (Object.keys(cardErrors).length > 0) errors.productCards = cardErrors;

  const ok = Object.keys(errors).length === 0;
  if (!ok) return { ok, errors };

  return {
    ok,
    errors,
    request: {
      type: input.type,
      title,
      scheduledAt: isEmergency ? null : input.scheduledAt,
      targetChannelAccountIds: input.targetChannelAccountIds,
      ...(productCards.length > 0 ? { productCards } : {}),
    },
  };
}
