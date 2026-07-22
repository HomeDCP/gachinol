import { UserRole } from '@gachinol/shared';
import type { CenterStaffUser, User } from '@gachinol/shared';

/**
 * 센터 관제 콘솔 사용자 — center_operator·admin만.
 * shared에는 isReporterUser만 있고 센터 가드가 없어(CenterStaffUser는 announcer 포함) 앱 로컬 순수 술어를 둔다.
 * (shared 무변경 — 타입 추가가 아니라 함수)
 */
export type CenterConsoleUser = CenterStaffUser & {
  role: typeof UserRole.CenterOperator | typeof UserRole.Admin;
};

/** center_operator·admin은 true / reporter·announcer·subscriber는 false */
export const isCenterConsoleUser = (u: User): u is CenterConsoleUser =>
  u.role === UserRole.CenterOperator || u.role === UserRole.Admin;

export const CENTER_ONLY_MESSAGE = '센터 관제 전용 앱입니다. 센터 운영자 계정으로 로그인해 주세요.';
