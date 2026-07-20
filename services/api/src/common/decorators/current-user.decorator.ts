import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@gachinol/shared';
import type { Request } from 'express';

/** JwtAuthGuard가 DB에서 로드해 req.user에 탑재한 shared User */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
  const req = ctx.switchToHttp().getRequest<Request & { user: User }>();
  return req.user;
});
