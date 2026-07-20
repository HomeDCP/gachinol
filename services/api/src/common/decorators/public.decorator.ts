import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** JwtAuthGuard 우회 — health·login·refresh 전용 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
