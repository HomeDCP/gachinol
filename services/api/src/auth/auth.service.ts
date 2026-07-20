import { Injectable } from '@nestjs/common';
import type { AuthTokens, LoginResponse } from '@gachinol/shared';
import * as argon2 from 'argon2';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../prisma/prisma.service';
import { toUser } from '../users/user.mapper';
import { ARGON2_OPTIONS } from './argon2.options';
import { TokenService } from './token.service';

/** 계정 열거 방지 — 이메일 부재/비번 불일치/비활성 구분 없이 동일 메시지 */
const LOGIN_FAILED = () =>
  new DomainException('unauthorized', '이메일 또는 비밀번호가 올바르지 않습니다');

/**
 * 타이밍 균일화용 더미 해시 (1회 선계산) — 계정 부재·비번 미설정 경로도 실제 계정과
 * 동일한 argon2 verify 비용을 지불해, 응답 시간 차로 계정 존재가 열거되지 않게 한다.
 */
const DUMMY_HASH: Promise<string> = argon2.hash('timing-equalizer-dummy-password', ARGON2_OPTIONS);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const row = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!row?.passwordHash) {
      // 더미 해시 검증으로 시간 프로파일 균일화 — 결과는 버리고 항상 동일 401
      await argon2.verify(await DUMMY_HASH, password).catch(() => false);
      throw LOGIN_FAILED();
    }

    const ok = await argon2.verify(row.passwordHash, password).catch(() => false);
    if (!ok) throw LOGIN_FAILED();
    if (row.status !== 'active') throw LOGIN_FAILED();

    const user = toUser(row);
    const tokens = await this.tokens.issueForLogin(user);
    return { user, tokens };
  }

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revokeSession(refreshToken);
  }
}
