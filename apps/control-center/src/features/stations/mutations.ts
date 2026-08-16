import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type {
  CreateStationRequest,
  Station,
  StationId,
  TransitionStationRequest,
  UpdateStationRequest,
} from '@gachinol/shared';
import { createStation, transitionStation, updateStation } from '../../api/stations';
import { isApiClientError } from '../../api/errors';
import { useApiClient } from '../../auth/auth-context';
import { stationKeys } from '../../query/keys';
import { showToast } from '../../ui/toast';

/**
 * 지사 mutation 공통 규칙 — **낙관적 업데이트 금지**.
 * 상태 전이는 서버 CAS(`updateMany where status=from`)라 409가 정상 경합 흐름이고,
 * `dormantSince` 같은 파생 필드도 서버가 정한다 → 클라가 예측할 대상이 아니다.
 * (추천·라이브 탭 선례 동형: 성공은 detail 병합 후 prefix invalidate, 409는 invalidate + 토스트)
 */

function applyStationResult(queryClient: QueryClient, station: Station): void {
  queryClient.setQueryData<Station>(stationKeys.detail(station.id), station);
  void queryClient.invalidateQueries({ queryKey: stationKeys.all });
}

/** 409(conflict·invalid_transition): 서버가 이미 다른 상태다 — 재조회로 화면을 진실에 맞춘다 */
function handleStationConflict(queryClient: QueryClient, id: StationId, err: unknown): void {
  if (isApiClientError(err) && err.status === 409) {
    void queryClient.invalidateQueries({ queryKey: stationKeys.all });
    showToast('지사 상태가 이미 변경되어 새로고침했습니다');
  }
}

export interface TransitionStationVars {
  id: StationId;
  body: TransitionStationRequest;
}

/**
 * 상태 전이 — center_operator·admin. 목적 상태는 화면이 shared 전이맵에서 파생해 넘긴다
 * (`features/stations/actions.ts`). 여기서 상태 이름을 알 필요가 없다.
 */
export function useTransitionStation() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: TransitionStationVars) => transitionStation(client, id, body),
    onSuccess: (station) => applyStationResult(queryClient, station),
    onError: (err, vars) => handleStationConflict(queryClient, vars.id, err),
  });
}

/** 생성 — **admin 전용**. 실패(code 중복 409 등)는 폼이 서버 메시지를 그대로 보여준다 */
export function useCreateStation() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStationRequest) => createStation(client, body),
    onSuccess: (station) => applyStationResult(queryClient, station),
  });
}

export interface UpdateStationVars {
  id: StationId;
  body: UpdateStationRequest;
}

/** 수정 — **admin 전용** */
export function useUpdateStation() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: UpdateStationVars) => updateStation(client, id, body),
    onSuccess: (station) => applyStationResult(queryClient, station),
  });
}
