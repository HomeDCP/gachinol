import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@gachinol/shared';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { DomainException } from '../../common/errors/domain.exception';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { toUser } from '../../users/user.mapper';
import type { AccessTokenPayload } from '../token.service';

/**
 * 전역 APP_GUARD 1번째 — @Public() 없으면 Bearer access 토큰 필수.
 * 검증 후 DB에서 사용자 로드(status!=='active' → 401)해 req.user에 shared User 탑재 —
 * 정지 계정 즉시 차단.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    const token = this.extractBearer(req);
    if (!token) throw new DomainException('unauthorized', '인증이 필요합니다');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      throw new DomainException('unauthorized', '유효하지 않은 토큰입니다');
    }
    if (payload.typ !== 'access') {
      throw new DomainException('unauthorized', '유효하지 않은 토큰입니다');
    }

    const row = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!row || row.status !== 'active') {
      throw new DomainException('unauthorized', '유효하지 않은 토큰입니다');
    }

    req.user = toUser(row);
    return true;
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }
}
