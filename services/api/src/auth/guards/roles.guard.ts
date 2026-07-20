import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User, UserRole } from '@gachinol/shared';
import type { Request } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { DomainException } from '../../common/errors/domain.exception';

/**
 * 전역 APP_GUARD 2번째 — @Roles(...) 없으면 인증만 요구, 있으면 role 대조.
 * admin은 항상 통과(수퍼롤). 소유권(기자=자기 지사·자기 담당)은 서비스 계층 몫.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<readonly UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    const user = req.user;
    if (!user) return true; // @Public() 경로 — JwtAuthGuard가 통과시킨 경우

    if (user.role === 'admin') return true;
    if (roles.includes(user.role)) return true;

    throw new DomainException('forbidden', '이 작업을 수행할 권한이 없습니다', {
      requiredRoles: roles,
    });
  }
}
