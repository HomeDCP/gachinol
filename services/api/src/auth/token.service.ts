import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthTokens, StationId, User, UserId, UserRole } from '@gachinol/shared';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { toUser } from '../users/user.mapper';

/** access 토큰 payload — 상태 비저장(블랙리스트 없음, 만료 창 수용) */
export interface AccessTokenPayload {
  sub: UserId;
  role: UserRole;
  stationId: StationId | null;
  typ: 'access';
}

/** refresh 토큰 payload — jti = refresh_tokens.id, fam = familyId(로그인 1회 = family 1개) */
export interface RefreshTokenPayload {
  sub: UserId;
  jti: string;
  fam: string;
  typ: 'refresh';
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

const UNAUTHORIZED = () => new DomainException('unauthorized', '유효하지 않은 토큰입니다');

/** 발급·검증·회전·family 폐기 — refresh 회전 + 재사용 탐지(탈취 대응) */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** 로그인: 새 family 개설 + 토큰쌍 발급 */
  async issueForLogin(user: User): Promise<AuthTokens> {
    return this.issuePair(user, uuidv7(), null);
  }

  /**
   * refresh 회전 프로토콜:
   * (a) 행 없음/만료 → 401 (b) revokedAt 있음 = 재사용 탐지 → family 전체 폐기 + 401
   * (c) 정상 → 기존 행 폐기 기록 + 새 행 insert → 새 토큰쌍
   * 동시 재사용(경합)은 issuePair의 CAS(revokedAt IS NULL 조건부 폐기)가 탐지한다 —
   * 아래 revokedAt 검사는 빠른 경로일 뿐 원자성 보장은 CAS의 몫.
   */
  async rotate(refreshJwt: string): Promise<AuthTokens> {
    const payload = await this.verifyRefresh(refreshJwt);

    const row = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (!row || row.tokenHash !== sha256(refreshJwt)) throw UNAUTHORIZED();
    if (row.expiresAt.getTime() <= Date.now()) throw UNAUTHORIZED();

    if (row.revokedAt) {
      // 재사용 탐지 — 탈취 가능성: 해당 family 전체 무효화
      await this.revokeFamily(row.familyId);
      throw UNAUTHORIZED();
    }

    const userRow = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!userRow || userRow.status !== 'active') throw UNAUTHORIZED();
    const user = toUser(userRow);

    return this.issuePair(user, row.familyId, row.id);
  }

  /** 로그아웃 — 해당 세션(family)만 폐기. 다기기: 기기별 로그인 = 기기별 family */
  async revokeSession(refreshJwt: string): Promise<void> {
    const payload = await this.verifyRefresh(refreshJwt);
    const row = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (row) await this.revokeFamily(row.familyId);
  }

  private async verifyRefresh(refreshJwt: string): Promise<RefreshTokenPayload> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshJwt, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw UNAUTHORIZED();
    }
    if (payload.typ !== 'refresh') throw UNAUTHORIZED();
    return payload;
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** 토큰쌍 발급 + refresh 행 insert (rotatedFromId가 있으면 기존 행 폐기 기록과 원자적으로) */
  private async issuePair(
    user: User,
    familyId: string,
    rotatedFromId: string | null,
  ): Promise<AuthTokens> {
    const jti = uuidv7(); // = refresh_tokens.id (인프라 ID — 도메인 브랜드 없음)

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      role: user.role,
      stationId: 'stationId' in user && user.stationId ? user.stationId : null,
      typ: 'access',
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      jti,
      fam: familyId,
      typ: 'refresh',
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', { infer: true }),
    });
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', { infer: true }),
    });

    const accessExp = this.expiresAtOf(accessToken);
    const refreshExp = this.expiresAtOf(refreshToken);

    const insert = {
      id: jti,
      userId: user.id as string,
      tokenHash: sha256(refreshToken), // 원문·시크릿 저장 금지
      familyId,
      expiresAt: refreshExp,
    };

    if (rotatedFromId) {
      // CAS — revokedAt IS NULL 조건부 폐기 (콘텐츠 전이 applyHop과 동일 패턴).
      // 같은 토큰의 동시 회전은 한쪽만 count=1로 승리 — TOCTOU로 재사용 탐지가 뚫리지 않는다.
      const rotated = await this.prisma.$transaction(async (tx) => {
        const res = await tx.refreshToken.updateMany({
          where: { id: rotatedFromId, revokedAt: null },
          data: { revokedAt: new Date(), replacedById: jti },
        });
        if (res.count === 0) return false;
        await tx.refreshToken.create({ data: insert });
        return true;
      });
      if (!rotated) {
        // 동시 재사용 탐지 — 탈취 가능성: family 전체 무효화 (트랜잭션 밖 — 롤백에 휩쓸리면 안 된다)
        await this.revokeFamily(familyId);
        throw UNAUTHORIZED();
      }
    } else {
      await this.prisma.refreshToken.create({ data: insert });
    }

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: accessExp.toISOString(),
      refreshTokenExpiresAt: refreshExp.toISOString(),
    };
  }

  /** 서명된 JWT의 exp 클레임 → Date (shared 시간 규약: ISO 절대시각) */
  private expiresAtOf(token: string): Date {
    const decoded = this.jwt.decode<{ exp?: number }>(token);
    if (!decoded?.exp) throw new DomainException('internal', '토큰 만료 시각 계산 실패');
    return new Date(decoded.exp * 1000);
  }
}
