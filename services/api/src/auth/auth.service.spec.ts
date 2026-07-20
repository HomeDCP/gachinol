import * as argon2 from 'argon2';
import { makePrismaMock } from '../test-support/fixtures';
import { AuthService } from './auth.service';

describe('AuthService — 로그인 (계정 열거 방지)', () => {
  const password = 'correct-horse-battery';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  });

  const userRow = (over: Record<string, unknown> = {}) => ({
    id: 'u-1',
    role: 'admin',
    name: '관리자',
    email: 'admin@gachinol.kr',
    phone: null,
    profileImageUrl: null,
    status: 'active',
    stationId: null,
    passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  const setup = (row: ReturnType<typeof userRow> | null) => {
    const prisma = makePrismaMock();
    prisma.user.findUnique.mockResolvedValue(row);
    const tokens = { issueForLogin: jest.fn().mockResolvedValue({ accessToken: 'a' }) };
    return new AuthService(prisma, tokens as never);
  };

  const failMessage = async (service: AuthService, email: string, pw: string) => {
    const err = await service.login(email, pw).then(
      () => null,
      (e) => e,
    );
    expect(err).toMatchObject({ code: 'unauthorized' });
    return err.message as string;
  };

  it('성공 — user(passwordHash 미노출) + tokens', async () => {
    const service = setup(userRow());
    const res = await service.login('Admin@Gachinol.KR', password); // 대소문자 정규화
    expect(res.user.role).toBe('admin');
    expect((res.user as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    expect(res.tokens).toBeDefined();
  });

  it('실패 3종(이메일 부재·비번 불일치·비활성)은 동일 메시지 401', async () => {
    const messages = await Promise.all([
      failMessage(setup(null), 'nobody@x.io', password),
      failMessage(setup(userRow()), 'admin@gachinol.kr', 'wrong-password'),
      failMessage(setup(userRow({ status: 'suspended' })), 'admin@gachinol.kr', password),
    ]);
    expect(new Set(messages).size).toBe(1);
  });
});
