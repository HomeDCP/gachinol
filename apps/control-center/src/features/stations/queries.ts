import { useQuery } from '@tanstack/react-query';
import { toId, type Paginated, type Station, type StationId } from '@gachinol/shared';
import { getStation, listStations } from '../../api/stations';
import { useApiClient } from '../../auth/auth-context';
import { stationKeys } from '../../query/keys';

/**
 * 지사 로스터 — kind='branch'로 12지사(≤13행). pageSize 100이면 1페이지로 충분.
 * StationOverview 집계 엔드포인트는 부재 → 사용하지 않는다(집계 날조 금지).
 */
export function useBranchStations() {
  const client = useApiClient();
  return useQuery<Paginated<Station>>({
    queryKey: stationKeys.list({ kind: 'branch' }),
    queryFn: () => listStations(client, { kind: 'branch', pageSize: 100 }),
    staleTime: 5 * 60 * 1000,
  });
}

/** 지사 단건 — 이름은 사실상 불변, staleTime Infinity. id 미정 시 미발사(enabled 가드) */
export function useStation(id: StationId | undefined) {
  const client = useApiClient();
  return useQuery<Station>({
    queryKey: stationKeys.detail(id ?? toId<StationId>('none')),
    queryFn: () => getStation(client, id!),
    enabled: id != null,
    staleTime: Infinity,
  });
}
