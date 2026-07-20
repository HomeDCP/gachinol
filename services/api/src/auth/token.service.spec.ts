import { JwtService } from '@nestjs/jwt';
import { adminUser, makePrismaMock } from '../test-support/fixtures';
import { TokenService } from './token.service';

const SECRETS = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'r'.repeat(32),
  JWT_ACCESS_EXPIRES_IN: '900s',
  JWT_REFRESH_EXPIRES_IN: '14d',
} as Record<string, string>;

describe('TokenService — refresh 회전·재사용 탐지', () => {
  const setup = () => {
    const prisma = makePrismaMock();
    const config = { get: jest.fn((key: string) => SECRETS[key]) };
    const service = new TokenService(new JwtService({}), prisma, config as never);
    return { prisma, service };
  };

  const login = async (ctx: ReturnType<typeof setup>) => {
    const tokens = await ctx.service.issueForLogin(adminUser());
    const row = ctx.prisma.refreshToken.create.mock.calls.at(-1)[0].data;
    return { tokens, row: { ...row, revokedAt: null, replacedById: null, createdAt: new Date() } };
  };

  it('로그인 발급 — refresh 행 insert(sha256 해시, 원문 저장 금지) + ISO 절대 만료 2필드', async () => {
    const ctx = setup();
    const { tokens, row } = await login(ctx);

    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toBe(tokens.refreshToken);
    expect(new Date(tokens.accessTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(tokens.refreshTokenExpiresAt).getTime()).toBeGreaterThan(
      new Date(tokens.accessTokenExpiresAt).getTime(),
    );
  });

  it('정상 회전 — 기존 행 폐기+replacedById 기록, 새 행 insert, 같은 family', async () => {
    const ctx = setup();
    const { tokens, row } = await login(ctx);
    ctx.prisma.refreshToken.findUnique.mockResolvedValue(row);
    ctx.prisma.user.findUnique.mockResolvedValue({
      id: 'u-admin',
      role: 'admin',
      name: '관리자',
      email: 'admin@x.io',
      phone: null,
      profileImageUrl: null,
      status: 'active',
      stationId: null,
      passwordHash: 'h',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const rotated = await ctx.service.rotate(tokens.refreshToken);

    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
    // CAS — revokedAt IS NULL 조건부 폐기 (무조건 update 금지: 동시 재사용 탐지의 근거)
    const updateArgs = ctx.prisma.refreshToken.updateMany.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: row.id, revokedAt: null });
    expect(updateArgs.data.revokedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.replacedById).toBeTruthy();
    const newRow = ctx.prisma.refreshToken.create.mock.calls.at(-1)[0].data;
    expect(newRow.familyId).toBe(row.familyId);
  });

  it('동시 회전 경합(CAS 패배) → family 전체 폐기 + 401, 새 행 미발급', async () => {
    const ctx = setup();
    const { tokens, row } = await login(ctx);
    ctx.prisma.refreshToken.findUnique.mockResolvedValue(row); // 아직 revokedAt=null로 읽힘 (TOCTOU 창)
    ctx.prisma.user.findUnique.mockResolvedValue({
      id: 'u-admin',
      role: 'admin',
      name: '관리자',
      email: 'admin@x.io',
      phone: null,
      profileImageUrl: null,
      status: 'active',
      stationId: null,
      passwordHash: 'h',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // 첫 updateMany(조건부 폐기)가 count=0 — 다른 요청이 먼저 회전에 성공한 경합 상황
    ctx.prisma.refreshToken.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 1 });

    await expect(ctx.service.rotate(tokens.refreshToken)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    // 재사용 탐지 발동 — family 전체 폐기
    expect(ctx.prisma.refreshToken.updateMany).toHaveBeenLastCalledWith({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    // 새 refresh 행은 발급되지 않는다 (create 호출은 로그인 발급분 1건뿐)
    expect(ctx.prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('폐기된 토큰 재사용 → family 전체 폐기 + 401', async () => {
    const ctx = setup();
    const { tokens, row } = await login(ctx);
    ctx.prisma.refreshToken.findUnique.mockResolvedValue({ ...row, revokedAt: new Date() });

    await expect(ctx.service.rotate(tokens.refreshToken)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(ctx.prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('만료된 행 → 401', async () => {
    const ctx = setup();
    const { tokens, row } = await login(ctx);
    ctx.prisma.refreshToken.findUnique.mockResolvedValue({
      ...row,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(ctx.service.rotate(tokens.refreshToken)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('typ 불일치(access 토큰으로 rotate) → 401', async () => {
    const ctx = setup();
    const tokens = await ctx.service.issueForLogin(adminUser());
    await expect(ctx.service.rotate(tokens.accessToken)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });
});
