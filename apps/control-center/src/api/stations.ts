import type {
  CreateStationRequest,
  Paginated,
  Station,
  StationId,
  StationListQuery,
  TransitionStationRequest,
  UpdateStationRequest,
} from '@gachinol/shared';
import type { ApiClient } from './client';

/**
 * 지사(Station) — 엔드포인트별 RBAC가 **서로 다르다**(services/api/src/stations/stations.controller.ts 원천).
 *   GET  /stations, /stations/:id            → @Roles 없음 = 인증만
 *   POST /stations/:id/transitions           → @Roles('admin','center_operator')
 *   POST /stations, PATCH /stations/:id      → @Roles('admin')   ← 센터 운영자는 403
 * 이 차이는 `features/stations/permissions.ts`가 술어로 표현하며, 화면은 권한 없는 액션을
 * **렌더하지 않는다**(눌러야 403을 받는 버튼을 그리지 않는다).
 */

/** GET /v1/stations — 인증만 필요 (@Roles 없음). 센터는 kind='branch'로 12지사 로스터 조회 */
export const listStations = (c: ApiClient, q: StationListQuery): Promise<Paginated<Station>> =>
  c.request<Paginated<Station>>('GET', '/stations', {
    query: { page: q.page, pageSize: q.pageSize, kind: q.kind, status: q.status },
  });

/** GET /v1/stations/:id — 인증만 필요. 상세의 지사명 표시용 */
export const getStation = (c: ApiClient, id: StationId): Promise<Station> =>
  c.request<Station>('GET', `/stations/${id}`);

/**
 * POST /v1/stations/:id/transitions — 지사 상태 전이. **HttpCode 200**(201 아님).
 * `dormant→operating`이 CLAUDE.md §11 "애월·제주시 부활" MVP의 실체다.
 *
 * 합법 전이의 유일 원천은 shared `STATION_STATUS_TRANSITIONS`이고 서버
 * (`StationWorkflowService`)가 ① 전이맵 대조 → `invalid_transition`(409),
 * ② `updateMany(where status=from)` **CAS** → `conflict`(409),
 * ③ `status_transition_logs`(entityType='station') 감사 기록,
 * ④ `dormantSince` 토글(dormant 진입=now, 이탈=null)을 강제한다.
 * 즉 409는 오류가 아니라 정상 경합 흐름 → 낙관적 업데이트 금지, invalidate로 복구한다.
 */
export const transitionStation = (
  c: ApiClient,
  id: StationId,
  body: TransitionStationRequest,
): Promise<Station> => c.request<Station>('POST', `/stations/${id}/transitions`, { body });

/**
 * POST /v1/stations — **admin 전용**. 서버가 `status='planned'`로 시작시킨다
 * (생성 바디에 status가 없다 — 운영 시작은 반드시 전이 경로를 거친다).
 * `code`는 unique slug라 중복이면 409.
 */
export const createStation = (c: ApiClient, body: CreateStationRequest): Promise<Station> =>
  c.request<Station>('POST', '/stations', { body });

/**
 * PATCH /v1/stations/:id — **admin 전용**. 계약상 `status`·`code`·`kind`는 수정 대상이 아니다
 * (상태는 transitions 경로 전용). 보낸 키만 갱신되며 **null로 지우기는 미지원**.
 */
export const updateStation = (
  c: ApiClient,
  id: StationId,
  body: UpdateStationRequest,
): Promise<Station> => c.request<Station>('PATCH', `/stations/${id}`, { body });
