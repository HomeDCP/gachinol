import type { PageQuery } from '../common/pagination';
import type { ISODateOnlyString } from '../common/time';
import type { StationKind, StationStatus } from './station';

export interface CreateStationRequest {
  code: string;
  name: string;
  kind: StationKind;
  region: string;
  description?: string;
  thumbnailUrl?: string;
  /** 공개 대표번호 — PII 판정 근거는 `Station.supportTel` 주석. 빈 문자열·공백은 서버가 거부 */
  supportTel?: string;
  /** 공식 YouTube 채널·라이브 URL (https만) */
  youtubeUrl?: string;
  sortOrder: number;
  foundedAt?: ISODateOnlyString;
}

export interface UpdateStationRequest {
  name?: string;
  region?: string;
  description?: string;
  thumbnailUrl?: string;
  /** 공개 대표번호 — 값 설정만 가능(기존 thumbnailUrl·foundedAt과 동일 규약: null 지우기 미지원) */
  supportTel?: string;
  youtubeUrl?: string;
  sortOrder?: number;
  foundedAt?: ISODateOnlyString;
}

export interface StationListQuery extends PageQuery {
  kind?: StationKind;
  status?: StationStatus;
}

/** POST /v1/stations/:id/transitions — 지사 부활(dormant→operating) 등 */
export interface TransitionStationRequest {
  toStatus: StationStatus;
  note?: string;
}
