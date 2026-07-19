import type { StationId } from '../common/id';
import type { ISODateOnlyString, ISODateString, Timestamps } from '../common/time';

/**
 * 허브 앤 스포크. 센터 = `kind: 'center'`인 Station 정확히 1행(DB partial unique index),
 * 지사 = `branch` 12행. 12개 지사 목록은 타입이 아니라 DB 시드 데이터.
 * 현재 시드: 애월·제주시 = dormant, 나머지 10곳 = planned, 센터 = operating.
 */
export const StationKind = {
  /** 제주방송센터 (허브·컨트롤타워) */
  Center: 'center',
  /** 마을방송국 지사 */
  Branch: 'branch',
} as const;
export type StationKind = (typeof StationKind)[keyof typeof StationKind];

export const StationStatus = {
  /** 운영 중 */
  Operating: 'operating',
  /** 설립됐으나 휴무 (현재: 애월·제주시) */
  Dormant: 'dormant',
  /** 설립 예정 */
  Planned: 'planned',
} as const;
export type StationStatus = (typeof StationStatus)[keyof typeof StationStatus];

export const STATION_STATUS_TRANSITIONS = {
  planned: ['operating'],
  operating: ['dormant'],
  /** 휴무 지사 부활 (MVP: 애월·제주시) */
  dormant: ['operating'],
} as const satisfies Record<StationStatus, readonly StationStatus[]>;

export interface Station extends Timestamps {
  id: StationId;
  /** unique slug (예: 'center', 'aewol', 'jeju-si') — URL·room 네이밍 키 */
  code: string;
  /** 예: '애월 마을방송국' */
  name: string;
  kind: StationKind;
  status: StationStatus;
  /** 행정구역 자유 표기 (예: '제주시 애월읍') — 열거화하지 않음 (N 확장 대응) */
  region: string;
  description?: string;
  /** 구독자 앱 지사 카드 이미지 */
  thumbnailUrl?: string;
  /** "한 화면에서 전 지사 나열" 정렬 순서 */
  sortOrder: number;
  foundedAt?: ISODateOnlyString;
  /** status='dormant'일 때 */
  dormantSince?: ISODateString;
}

/** 구독자 앱 지사 목록용 축약 DTO */
export interface StationSummary {
  id: StationId;
  name: string;
  region: string;
  status: StationStatus;
  thumbnailUrl?: string;
}
