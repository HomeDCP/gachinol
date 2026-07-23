import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@gachinol/shared';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { toUser } from '../users/user.mapper';
import type { AccessTokenPayload } from '../auth/token.service';

/**
 * WS 핸드셰이크 JWT 검증 — JwtAuthGuard(jwt-auth.guard.ts)의 검증+로드 로직을 그대로 이식.
 * verifyAsync(JWT_ACCESS_SECRET)→typ==='access'→Prisma user 로드→status==='active'→toUser.
 * 실패는 예외가 아니라 null 반환(채팅은 공개라 연결을 끊지 않고 익명 강등).
 */
@Injectable()
export class WsAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async verify(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      return null;
    }
    if (payload.typ !== 'access') return null;

    const row = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!row || row.status !== 'active') return null;
    return toUser(row);
  }
}
