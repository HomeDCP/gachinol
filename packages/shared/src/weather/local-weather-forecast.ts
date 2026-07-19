import type {
  CommunityFigureId,
  ContentId,
  ForecastId,
  LiveSessionId,
  StationId,
} from '../common/id';
import type { ISODateOnlyString, ISODateString, Timestamps } from '../common/time';

/**
 * 지역특화 날씨예보 ⭐ 킬러 콘셉트.
 * 기상청이 아닌 이장·촌장·어촌계장의 '감' 기반.
 * 구조는 "오늘 관찰 → 내일 예측 → 활동 제안" 3필드 고정.
 */
export const ForecastStatus = {
  Draft: 'draft',
  Published: 'published',
} as const;
export type ForecastStatus = (typeof ForecastStatus)[keyof typeof ForecastStatus];

export interface LocalWeatherForecast extends Timestamps {
  id: ForecastId;
  /** 예보 지역 = 지사 */
  stationId: StationId;
  /** 예보자 — 이장·촌장·어촌계장 (CommunityFigure). 이름·직함·bio·거주 이력은 join */
  forecasterId: CommunityFigureId;
  /** 예보 대상일(내일). (stationId, forecastDate, forecasterId) unique */
  forecastDate: ISODateOnlyString;
  /** 오늘 관찰 — "오늘 바당이 유난히 잔잔했다" */
  todayObservation: string;
  /** 내일 예측 — "내일 아침엔 바람 없을 거라" */
  tomorrowPrediction: string;
  /** 활동 제안 — "물질 나가기 좋은 날" */
  activitySuggestion: string;
  /** 예보 영상 콘텐츠 */
  relatedContentId: ContentId | null;
  relatedLiveSessionId: LiveSessionId | null;
  status: ForecastStatus;
  publishedAt: ISODateString | null;
}
