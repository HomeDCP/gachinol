import type { ContentId, StationId } from '../common/id';
import type { CursorQuery } from '../common/pagination';
import type { ISODateString } from '../common/time';
import type { CultureTopic, ProgramCategory } from '../content/category';

/** 구독자 앱 콘텐츠 피드 조회 */
export interface FeedQuery extends CursorQuery {
  stationId?: StationId;
  category?: ProgramCategory;
}

/** published 콘텐츠만의 공개 투영 */
export interface FeedItem {
  contentId: ContentId;
  title: string;
  category: ProgramCategory;
  cultureTopics?: readonly CultureTopic[];
  stationId: StationId;
  /** 비정규화 */
  stationName: string;
  thumbnailUrl?: string;
  durationSec: number;
  /** AI 요약 */
  summary?: string;
  publishedAt: ISODateString;
}

export interface CaptionCue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface PlaybackInfo {
  contentId: ContentId;
  title: string;
  stationName: string;
  /** 서명 포함 재생 URL */
  hlsUrl: string;
  posterUrl?: string;
  durationSec: number;
  /** Scene.caption에서 파생 */
  captions: readonly CaptionCue[];
  publishedAt: ISODateString;
}
