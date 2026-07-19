import type { ContentId, MediaAssetId, MediaSaleId, UserId } from '../common/id';
import type { Krw } from '../common/money';
import type { ISODateOnlyString, ISODateString, Timestamps } from '../common/time';

/** B2B 미디어 세일즈 — 생산 자료를 방송3사·종편·케이블에 판매 */
export const BuyerOrgType = {
  /** 방송3사(지상파) */
  Terrestrial: 'terrestrial',
  /** 종편 */
  GeneralProgramming: 'general_programming',
  Cable: 'cable',
  Other: 'other',
} as const;
export type BuyerOrgType = (typeof BuyerOrgType)[keyof typeof BuyerOrgType];

export const LicenseType = {
  Exclusive: 'exclusive',
  NonExclusive: 'non_exclusive',
} as const;
export type LicenseType = (typeof LicenseType)[keyof typeof LicenseType];

export const MediaSaleStatus = {
  /** 접촉·리드 */
  Lead: 'lead',
  /** 협상 중 */
  Negotiating: 'negotiating',
  /** 계약 체결 */
  Contracted: 'contracted',
  /** 자료 납품 완료 */
  Delivered: 'delivered',
  /** 정산 완료 [종결] */
  Settled: 'settled',
  /** 철회·결렬 [종결] */
  Canceled: 'canceled',
} as const;
export type MediaSaleStatus = (typeof MediaSaleStatus)[keyof typeof MediaSaleStatus];

export const MEDIA_SALE_STATUS_TRANSITIONS = {
  lead: ['negotiating', 'canceled'],
  /** 협상 결렬 → 리드로 복귀 가능 */
  negotiating: ['contracted', 'lead', 'canceled'],
  contracted: ['delivered', 'canceled'],
  delivered: ['settled'],
  settled: [],
  canceled: [],
} as const satisfies Record<MediaSaleStatus, readonly MediaSaleStatus[]>;

export interface MediaSale extends Timestamps {
  id: MediaSaleId;
  /** 판매 대상 자료 — 패키지 판매 가능 */
  contentIds: readonly ContentId[];
  buyer: {
    name: string;
    type: BuyerOrgType;
    contactName?: string;
    contactEmail?: string;
  };
  license: {
    type: LicenseType;
    territory?: string;
    periodStart?: ISODateOnlyString;
    /** 무기한이면 생략 */
    periodEnd?: ISODateOnlyString;
    usageNote?: string;
  };
  priceKrw: Krw;
  status: MediaSaleStatus;
  /** 납품 자산 — checksumSha256으로 검증 */
  deliveredAssetIds: readonly MediaAssetId[];
  /** 담당 센터 운영자 */
  ownerUserId: UserId;
  note?: string;
  contractedAt: ISODateString | null;
  deliveredAt: ISODateString | null;
  settledAt: ISODateString | null;
}
