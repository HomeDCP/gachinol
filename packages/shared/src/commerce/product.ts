import type { CommunityFigureId, ProductId, StationId } from '../common/id';
import type { Krw } from '../common/money';
import type { Timestamps } from '../common/time';

export const ProductStatus = {
  Draft: 'draft',
  OnSale: 'on_sale',
  SoldOut: 'sold_out',
  /** [종결] */
  Discontinued: 'discontinued',
} as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

export const PRODUCT_STATUS_TRANSITIONS = {
  draft: ['on_sale', 'discontinued'],
  on_sale: ['sold_out', 'discontinued'],
  /** 재입고 */
  sold_out: ['on_sale', 'discontinued'],
  discontinued: [],
} as const satisfies Record<ProductStatus, readonly ProductStatus[]>;

export interface Product extends Timestamps {
  id: ProductId;
  /** 산지 지사 */
  stationId: StationId;
  /** 판매자 — 이장·어촌계장·삼춘·부녀회장 (CommunityFigure, User 계정 불요) */
  sellerId: CommunityFigureId;
  name: string;
  description: string;
  priceKrw: Krw;
  /** null = 재고 미관리 */
  stockQty: number | null;
  /** 공개 이미지 — CDN URL 허용 */
  imageUrls: readonly string[];
  status: ProductStatus;
}
