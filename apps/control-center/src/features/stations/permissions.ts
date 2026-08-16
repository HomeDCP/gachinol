import { UserRole } from '@gachinol/shared';

/**
 * 지사 관리 RBAC 술어 — 원천은 `services/api/src/stations/stations.controller.ts`의 `@Roles`.
 *
 *   POST /stations/:id/transitions  @Roles('admin','center_operator')
 *   POST /stations                  @Roles('admin')
 *   PATCH /stations/:id             @Roles('admin')
 *
 * **이 앱은 두 role이 모두 들어온다**(`auth/role.ts`의 센터 게이트가 center_operator·admin을 통과시킨다)
 * → 앱 전역 게이트 하나로는 위 차이를 표현할 수 없어 엔드포인트 단위 술어가 필요하다.
 * `RolesGuard`는 admin을 수퍼롤로 항상 통과시키므로 admin은 두 술어 모두 true.
 *
 * ⚠️ 권한이 없으면 화면은 버튼을 **disabled가 아니라 미렌더**한다 — "버튼은 있는데 누르면 403"은
 * 이 리포가 Wave 8a에서 실제로 저지른 결함이라 재발 방지를 렌더 테스트로 고정한다.
 */

/** 상태 전이(부활·휴무 전환·운영 시작) — center_operator·admin */
export const canTransitionStation = (role: UserRole): boolean =>
  role === UserRole.Admin || role === UserRole.CenterOperator;

/** 지사 생성·수정 — **admin 전용**. center_operator가 호출하면 403 */
export const canManageStations = (role: UserRole): boolean => role === UserRole.Admin;

/** 생성·수정 버튼을 못 그릴 때 그 자리에 대신 놓는 설명(빈 화면·유령 버튼 금지) */
export const STATION_MANAGE_ADMIN_ONLY_NOTE =
  '지사 생성·수정은 관리자(admin) 계정만 할 수 있습니다.';
