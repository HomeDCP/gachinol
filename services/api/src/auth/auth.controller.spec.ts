import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { adminUser } from '../test-support/fixtures';
import { DomainException } from '../common/errors/domain.exception';
import { AuthController } from './auth.controller';
import { WEB_REFRESH_COOKIE, WEB_REFRESH_COOKIE_SECURE } from './auth.service';

/**
 * 웹 쿠키 세션 경로(`/auth/web/*`)와 기존 바디 경로의 **병행** 검증.
 * 핵심 불변식: ① 웹 응답 바디에는 refresh 원문이 절대 없다 ② 회전 실패 쿠키는 즉시 지운다
 * ③ 바디 경로는 손대지 않는다(네이티브 앱 무회귀).
 */
const tokens = (over: Record<string, string> = {}) => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  refreshTokenExpiresAt: new Date(Date.now() + 1_209_600_000).toISOString(),
  ...over,
});

const setup = (nodeEnv = 'development') => {
  const auth = {
    login: jest.fn().mockResolvedValue({ user: adminUser(), tokens: tokens() }),
    refresh: jest.fn().mockResolvedValue(tokens({ refreshToken: 'refresh-2' })),
    logout: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: () => nodeEnv } as unknown as ConfigService<never, true>;
  const controller = new AuthController(auth as never, config);
  jest
    .spyOn((controller as unknown as { logger: { warn: () => void } }).logger, 'warn')
    .mockImplementation(() => undefined);
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as Response;
  const req = (headers: Record<string, string> = {}) => ({ headers }) as unknown as Request;
  const setCookies = (): string[] => {
    const value = setHeader.mock.calls.at(-1)?.[1];
    return Array.isArray(value) ? (value as string[]) : [value as string];
  };
  return { auth, controller, res, req, setHeader, setCookies };
};

describe('AuthController — 웹 로그인(쿠키 발급)', () => {
  it('refresh는 Set-Cookie로만 나가고 응답 바디에는 없다', async () => {
    const { auth, controller, res, req, setCookies } = setup();

    const body = await controller.webLogin(
      { email: 'admin@gachinol.kr', password: 'pw' } as never,
      req(),
      res,
    );

    expect(auth.login).toHaveBeenCalledWith('admin@gachinol.kr', 'pw');
    expect(body.accessToken).toBe('access-1');
    expect(body.user.role).toBe('admin');
    expect(JSON.stringify(body)).not.toContain('refresh-1'); // 원문 유출 0
    expect(body.refreshTokenExpiresAt).toBeDefined(); // 만료 시각만 노출
    expect(setCookies()[0]).toContain(`${WEB_REFRESH_COOKIE}=refresh-1`);
    expect(setCookies()[0]).toContain('HttpOnly');
  });

  it('프로덕션이면 __Host- 접두 + Secure 쿠키', async () => {
    const { controller, res, req, setCookies } = setup('production');
    await controller.webLogin({ email: 'a@b.kr', password: 'pw' } as never, req(), res);
    expect(setCookies()[0]).toContain(`${WEB_REFRESH_COOKIE_SECURE}=`);
    expect(setCookies()[0]).toContain('Secure');
  });
});

describe('AuthController — 웹 refresh 회전', () => {
  it('쿠키에서 읽어 회전하고 새 쿠키로 교체한다(바디 미사용)', async () => {
    const { auth, controller, res, req, setCookies } = setup();

    const body = await controller.webRefresh(
      req({ cookie: `${WEB_REFRESH_COOKIE}=refresh-1` }),
      res,
    );

    expect(auth.refresh).toHaveBeenCalledWith('refresh-1');
    expect(body.accessToken).toBe('access-1');
    expect(JSON.stringify(body)).not.toContain('refresh-2');
    expect(setCookies()[0]).toContain(`${WEB_REFRESH_COOKIE}=refresh-2`);
  });

  it('쿠키 없음 → 401 + 쿠키 클리어', async () => {
    const { auth, controller, res, req, setCookies } = setup();

    await expect(controller.webRefresh(req(), res)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(setCookies().every((c) => c.includes('Max-Age=0'))).toBe(true);
  });

  // 죽은 쿠키를 남기면 브라우저가 같은 토큰을 계속 재전송해 재사용 탐지를 반복 트리거한다
  it('회전 실패(재사용 탐지로 family 폐기) → 쿠키 클리어 후 예외 전파', async () => {
    const { auth, controller, res, req, setCookies } = setup();
    auth.refresh.mockRejectedValue(new DomainException('unauthorized', '유효하지 않은 토큰입니다'));

    await expect(
      controller.webRefresh(req({ cookie: `${WEB_REFRESH_COOKIE}=stale` }), res),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(setCookies()).toHaveLength(2);
    expect(setCookies().every((c) => c.includes('Max-Age=0'))).toBe(true);
  });

  it('모호한 쿠키(토싱) → 회전 시도 없이 401 + 클리어', async () => {
    const { auth, controller, res, req, setCookies } = setup();

    await expect(
      controller.webRefresh(
        req({ cookie: `${WEB_REFRESH_COOKIE}=a; ${WEB_REFRESH_COOKIE}=b` }),
        res,
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(setCookies().every((c) => c.includes('Max-Age=0'))).toBe(true);
  });
});

describe('AuthController — 웹 로그아웃(멱등)', () => {
  it('세션(family) 폐기 + 두 이름 모두 클리어', async () => {
    const { auth, controller, res, req, setCookies } = setup();

    await controller.webLogout(req({ cookie: `${WEB_REFRESH_COOKIE}=refresh-1` }), res);

    expect(auth.logout).toHaveBeenCalledWith('refresh-1');
    expect(setCookies()).toHaveLength(2);
  });

  it('쿠키 없음·이미 폐기된 세션도 204로 끝난다(멱등)', async () => {
    const { auth, controller, res, req, setCookies } = setup();
    await expect(controller.webLogout(req(), res)).resolves.toBeUndefined();
    expect(auth.logout).not.toHaveBeenCalled();

    auth.logout.mockRejectedValue(new DomainException('unauthorized', '유효하지 않은 토큰입니다'));
    await expect(
      controller.webLogout(req({ cookie: `${WEB_REFRESH_COOKIE}=dead` }), res),
    ).resolves.toBeUndefined();
    expect(setCookies().every((c) => c.includes('Max-Age=0'))).toBe(true);
  });
});

describe('AuthController — 기존 바디 경로 무회귀', () => {
  it('바디 login은 refreshToken을 그대로 반환한다(네이티브 앱 계약 불변)', async () => {
    const { controller } = setup();
    const res = await controller.login({ email: 'a@b.kr', password: 'pw' } as never);
    expect(res.tokens.refreshToken).toBe('refresh-1');
  });

  it('바디 refresh/logout은 쿠키를 보지 않는다', async () => {
    const { auth, controller } = setup();
    await controller.refresh({ refreshToken: 'body-token' } as never);
    await controller.logout({ refreshToken: 'body-token' } as never);
    expect(auth.refresh).toHaveBeenCalledWith('body-token');
    expect(auth.logout).toHaveBeenCalledWith('body-token');
  });
});
