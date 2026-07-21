import type { Station, StationId } from '@gachinol/shared';
import type { ApiClient } from './client';

/** GET /v1/stations/:id — 인증만 필요 (@Roles 없음). 소속 지사명 표시용 */
export const getStation = (c: ApiClient, id: StationId): Promise<Station> =>
  c.request<Station>('GET', `/stations/${id}`);
