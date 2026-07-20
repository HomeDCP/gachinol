import type { User as UserRow } from '@prisma/client';
import { toUser } from './user.mapper';

describe('toUser — row → shared User 판별 유니언 복원', () => {
  const row = (over: Partial<UserRow> = {}): UserRow => ({
    id: 'u-1',
    role: 'reporter',
    name: '기자',
    email: 'r@gachinol.kr',
    phone: null,
    profileImageUrl: null,
    status: 'active',
    stationId: 's-aewol',
    passwordHash: 'argon2-hash',
    createdAt: new Date('2026-07-20T01:02:03.000Z'),
    updatedAt: new Date('2026-07-20T01:02:03.000Z'),
    ...over,
  });

  it('reporter — stationId 필수 복원, ISO 타임스탬프', () => {
    const user = toUser(row());
    expect(user.role).toBe('reporter');
    expect('stationId' in user && user.stationId).toBe('s-aewol');
    expect(user.createdAt).toBe('2026-07-20T01:02:03.000Z');
  });

  it('reporter인데 stationId null → internal (데이터 불변식 위반)', () => {
    expect(() => toUser(row({ stationId: null }))).toThrow(
      expect.objectContaining({ code: 'internal' }),
    );
  });

  it('passwordHash는 어떤 경우에도 통과하지 못한다', () => {
    const user = toUser(row()) as unknown as Record<string, unknown>;
    expect(user.passwordHash).toBeUndefined();
    expect(Object.keys(user)).not.toContain('passwordHash');
  });

  it('admin — 무소속 허용 (stationId undefined)', () => {
    const user = toUser(row({ role: 'admin', stationId: null }));
    expect(user.role).toBe('admin');
    expect('stationId' in user ? user.stationId : undefined).toBeUndefined();
  });

  it('subscriber — stationId 없음, null 필드는 undefined로 (wire에서 키 탈락)', () => {
    const user = toUser(row({ role: 'subscriber', stationId: null, email: null }));
    expect(user.role).toBe('subscriber');
    expect(user.email).toBeUndefined();
  });

  it('알 수 없는 role → internal', () => {
    expect(() => toUser(row({ role: 'hacker' }))).toThrow(
      expect.objectContaining({ code: 'internal' }),
    );
  });
});
