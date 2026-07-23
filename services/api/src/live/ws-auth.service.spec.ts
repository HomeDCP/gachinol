import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env.schema';
import { makePrismaMock } from '../test-support/fixtures';
import { WsAuthService } from './ws-auth.service';

const configMock = { get: () => 'access-secret' } as unknown as ConfigService<Env, true>;

const userRow = (over: Record<string, unknown> = {}) => ({
  id: 'u-1',
  role: 'center_operator',
  name: '센터',
  email: 'c@e.local',
  phone: null,
  profileImageUrl: null,
  status: 'active',
  stationId: 's-center',
  passwordHash: null,
  createdAt: new Date('2026-07-20T00:00:00Z'),
  updatedAt: new Date('2026-07-20T00:00:00Z'),
  ...over,
});

const setup = (verifyImpl: () => Promise<unknown>) => {
  const prisma = makePrismaMock();
  const jwt = { verifyAsync: jest.fn(verifyImpl) } as unknown as JwtService;
  return { prisma, service: new WsAuthService(jwt, configMock, prisma) };
};

describe('WsAuthService.verify', () => {
  it('토큰 없음 → null', async () => {
    const { service } = setup(async () => ({}));
    expect(await service.verify(undefined)).toBeNull();
  });

  it('검증 실패(throw) → null', async () => {
    const { service } = setup(async () => {
      throw new Error('bad');
    });
    expect(await service.verify('bad-token')).toBeNull();
  });

  it("typ!=='access' → null", async () => {
    const { service } = setup(async () => ({ sub: 'u-1', typ: 'refresh' }));
    expect(await service.verify('refresh-token')).toBeNull();
  });

  it('유저 부재/비활성 → null', async () => {
    const { prisma, service } = setup(async () => ({ sub: 'u-1', typ: 'access' }));
    prisma.user.findUnique.mockResolvedValue({ ...userRow({ status: 'suspended' }) });
    expect(await service.verify('t')).toBeNull();
  });

  it('정상 → shared User(toUser)', async () => {
    const { prisma, service } = setup(async () => ({ sub: 'u-1', typ: 'access' }));
    prisma.user.findUnique.mockResolvedValue(userRow());
    const user = await service.verify('t');
    expect(user?.id).toBe('u-1');
    expect(user?.role).toBe('center_operator');
  });
});
