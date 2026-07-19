import type { CommunityFigureId, StationId, UserId } from '../common/id';
import type { Timestamps } from '../common/time';

/**
 * 지역 인물 (판매자 겸 예보자).
 * 이장·촌장·어촌계장·삼춘·부녀회장은 앱 계정(User)이 없어도 존재한다.
 * 커머스 판매자(Product.sellerId)와 날씨 예보자(LocalWeatherForecast.forecasterId)가 공유하는
 * 단일 엔티티(값 객체 아님 — 여러 상품·예보에 걸친 동일성 유지).
 * 연락처(전화번호)는 개인정보라 공용 계약에서 제외(api 내부 스키마 전용).
 */
export const CommunityRole = {
  /** 이장 */
  VillageHead: 'village_head',
  /** 촌장 */
  TownHead: 'town_head',
  /** 어촌계장 */
  FishingVillageHead: 'fishing_village_head',
  /** 삼춘 (제주 방언 존칭) */
  Samchon: 'samchon',
  /** 부녀회장 */
  WomensAssociationHead: 'womens_association_head',
  Other: 'other',
} as const;
export type CommunityRole = (typeof CommunityRole)[keyof typeof CommunityRole];

export interface CommunityFigure extends Timestamps {
  id: CommunityFigureId;
  /** 활동 지역 지사 */
  stationId: StationId;
  /** 앱 계정 보유 시 연결. 없음 자체가 정보라 null */
  userId: UserId | null;
  name: string;
  role: CommunityRole;
  /** 자유 직함 보완 (예: '하귀2리 이장') */
  title?: string;
  /** 방송 소개문 (예: '애월에서 40년 물질') */
  bio?: string;
  photoUrl?: string;
}
