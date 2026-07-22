import type { Paginated, Station, StationId, StationListQuery } from '@gachinol/shared';
import type { ApiClient } from './client';

/** GET /v1/stations — 인증만 필요 (@Roles 없음). 센터는 kind='branch'로 12지사 로스터 조회 */
export const listStations = (c: ApiClient, q: StationListQuery): Promise<Paginated<Station>> =>
  c.request<Paginated<Station>>('GET', '/stations', {
    query: { page: q.page, pageSize: q.pageSize, kind: q.kind, status: q.status },
  });

/** GET /v1/stations/:id — 인증만 필요. 상세의 지사명 표시용 */
export const getStation = (c: ApiClient, id: StationId): Promise<Station> =>
  c.request<Station>('GET', `/stations/${id}`);
