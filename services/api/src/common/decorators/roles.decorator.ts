import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@gachinol/shared';

export const ROLES_KEY = 'roles';

/** 허용 role 명시 — 없으면 인증만 요구. admin은 RolesGuard에서 항상 통과(수퍼롤) */
export const Roles = (...roles: readonly UserRole[]) => SetMetadata(ROLES_KEY, roles);
