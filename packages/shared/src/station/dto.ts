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
  sortOrder: number;
  foundedAt?: ISODateOnlyString;
}

export interface UpdateStationRequest {
  name?: string;
  region?: string;
  description?: string;
  thumbnailUrl?: string;
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
