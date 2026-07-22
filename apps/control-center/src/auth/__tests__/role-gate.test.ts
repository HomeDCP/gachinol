import { UserRole, toId } from '@gachinol/shared';
import type { StationId, User, UserId } from '@gachinol/shared';
import { isCenterConsoleUser } from '../role';

const base = {
  id: toId<UserId>('user-1'),
  name: '테스트',
  status: 'active' as const,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const withRole = (role: User['role']): User =>
  ({
    ...base,
    role,
    ...(role === UserRole.Reporter ? { stationId: toId<StationId>('station-1') } : {}),
  }) as User;

describe('isCenterConsoleUser', () => {
  test('center_operator·admin → true', () => {
    expect(isCenterConsoleUser(withRole(UserRole.CenterOperator))).toBe(true);
    expect(isCenterConsoleUser(withRole(UserRole.Admin))).toBe(true);
  });

  test('reporter·announcer·subscriber → false', () => {
    expect(isCenterConsoleUser(withRole(UserRole.Reporter))).toBe(false);
    expect(isCenterConsoleUser(withRole(UserRole.Announcer))).toBe(false);
    expect(isCenterConsoleUser(withRole(UserRole.Subscriber))).toBe(false);
  });
});
