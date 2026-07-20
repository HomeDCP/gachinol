import type { LoginRequest, LogoutRequest, RefreshTokenRequest } from '@gachinol/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { ZodSchemaOf } from '../../common/zod';

export const zLogin = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
}) satisfies ZodSchemaOf<LoginRequest>;

export const zRefreshToken = z.object({
  refreshToken: z.string().min(1),
}) satisfies ZodSchemaOf<RefreshTokenRequest>;

export const zLogout = z.object({
  refreshToken: z.string().min(1),
}) satisfies ZodSchemaOf<LogoutRequest>;

export class LoginDto extends createZodDto(zLogin) {}
export class RefreshTokenDto extends createZodDto(zRefreshToken) {}
export class LogoutDto extends createZodDto(zLogout) {}
