import { BadGatewayException, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiError } from '@gachinol/shared';
import { ZodError } from 'zod';
import { ZodValidationException } from 'nestjs-zod';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { DomainException } from '../errors/domain.exception';

/**
 * 대장 #213 — 4xx가 로그에 전혀 남지 않아 프로덕션 장애 특정이 불가능했던 결함의 재발 방지.
 * 분기별로 (a) 로그가 남는지 (b) 응답 바디(ApiError 계약)가 그대로인지를 함께 단언한다.
 */
describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  /**
   * ⚠️ D1 검증 함정(2026-09-13 verifier 지적): `originalUrl`을 `path`와 동일하게 두거나 비워두면
   * "req.path → req.originalUrl" 같은 프로덕션 뮤테이션이 걸려도 로그엔 그냥 `undefined`가 찍힐 뿐이라
   * 우연히 red가 나고, 그 red는 "쿼리스트링이 안전하게 걸러졌다"는 의도된 실패가 아니다.
   * 그래서 여기서는 **항상** `originalUrl`에 path와 다른 실재 쿼리스트링(+비밀값)을 채우고,
   * `authorization`/`cookie` 헤더도 실값으로 채운다 — 로그 조립부가 그중 무엇을 실수로 집어도
   * 테스트가 "값이 로그에 실제로 나타났다"는 이유로 잡아내도록.
   */
  const makeHost = (method: string, path: string): ArgumentsHost => {
    const req = {
      method,
      path,
      originalUrl: `${path}?token=super-secret-token-999&password=hunter2`,
      headers: {
        authorization: 'Bearer super-secret-access-token-abcdef',
        cookie: 'session=super-secret-session-cookie-value',
      },
    };
    const res = { status: statusMock, json: jsonMock };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ArgumentsHost;
  };

  /** 모든 분기 공통 보안 단언 — 쿼리스트링·Authorization·Cookie가 로그 어디에도 나타나면 안 된다. */
  const expectNoSecretsLeaked = (logLine: string): void => {
    expect(logLine).not.toContain('token=');
    expect(logLine).not.toContain('super-secret-token-999');
    expect(logLine).not.toContain('password=');
    expect(logLine).not.toContain('hunter2');
    expect(logLine).not.toContain('?');
    expect(logLine).not.toContain('super-secret-access-token-abcdef');
    expect(logLine).not.toContain('super-secret-session-cookie-value');
  };

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    warnSpy = jest.spyOn((filter as unknown as { logger: { warn: () => void } }).logger, 'warn');
    errorSpy = jest.spyOn((filter as unknown as { logger: { error: () => void } }).logger, 'error');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('1) ZodValidationException → 400 로그 + 응답 바디 불변', () => {
    const zodError = new ZodError([
      { code: 'custom', path: ['email'], message: '이메일 형식이 아닙니다' },
    ]);
    const exception = new ZodValidationException(zodError);
    const host = makeHost('POST', '/v1/contents');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      code: 'validation_failed',
      message: '요청 검증에 실패했습니다',
      details: { issues: zodError.issues },
    } satisfies ApiError);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [logLine] = warnSpy.mock.calls[0] as [string];
    expect(logLine).toContain('POST');
    expect(logLine).toContain('/v1/contents');
    expect(logLine).toContain('400');
    expect(logLine).toContain('validation_failed');
    // 바디 원문(zod issues)이 로그에 그대로 새지 않아야 한다
    expect(logLine).not.toContain('email');
    expectNoSecretsLeaked(logLine);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('2) DomainException(not_found) → 404 로그 + 응답 바디 불변, details는 로그에 안 넣는다', () => {
    const exception = new DomainException('not_found', '콘텐츠를 찾을 수 없습니다', {
      contentId: 'secret-id-123',
    });
    const host = makeHost('GET', '/v1/contents/abc');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      code: 'not_found',
      message: '콘텐츠를 찾을 수 없습니다',
      details: { contentId: 'secret-id-123' },
    } satisfies ApiError);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [logLine] = warnSpy.mock.calls[0] as [string];
    expect(logLine).toContain('GET');
    expect(logLine).toContain('/v1/contents/abc');
    expect(logLine).toContain('404');
    expect(logLine).toContain('not_found');
    // details(식별정보 가능성)는 로그에 통째로 찍지 않는다
    expect(logLine).not.toContain('secret-id-123');
    expectNoSecretsLeaked(logLine);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('보안) 쿼리스트링(?token=...)·Authorization·Cookie가 4xx 경고 로그에 노출되지 않는다', () => {
    const exception = new DomainException('forbidden', '접근 권한이 없습니다');
    const host = makeHost('POST', '/v1/contents/abc/approve');

    filter.catch(exception, host);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [logLine] = warnSpy.mock.calls[0] as [string];
    // req.originalUrl(=path+쿼리스트링+비밀값)이 아니라 req.path만 로그에 들어가야 한다
    expect(logLine).toContain('/v1/contents/abc/approve');
    expectNoSecretsLeaked(logLine);
  });

  it('3) Prisma P2002 → 409 로그 + 응답 바디 불변', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('고유 제약 조건 충돌', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const host = makeHost('POST', '/v1/stations');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(409);
    expect(jsonMock).toHaveBeenCalledWith({
      code: 'conflict',
      message: '고유 제약 조건 충돌',
    } satisfies ApiError);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [logLine] = warnSpy.mock.calls[0] as [string];
    expect(logLine).toContain('POST');
    expect(logLine).toContain('/v1/stations');
    expect(logLine).toContain('409');
    expect(logLine).toContain('conflict');
    expectNoSecretsLeaked(logLine);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('3) Prisma P2025 → 404 로그 + 응답 바디 불변', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('대상을 찾을 수 없습니다', {
      code: 'P2025',
      clientVersion: 'test',
    });
    const host = makeHost('DELETE', '/v1/stations/xyz');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      code: 'not_found',
      message: '대상을 찾을 수 없습니다',
    } satisfies ApiError);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expectNoSecretsLeaked(warnSpy.mock.calls[0][0] as string);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('4) Nest 내장 HttpException(4xx: NotFoundException) → warn 로그 + 응답 바디 불변, 스택 없음', () => {
    const exception = new NotFoundException('Cannot GET /nope');
    const host = makeHost('GET', '/nope');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      code: 'not_found',
      message: 'Cannot GET /nope',
    } satisfies ApiError);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [logLine] = warnSpy.mock.calls[0] as [string];
    expect(logLine).toContain('GET');
    expect(logLine).toContain('/nope');
    expect(logLine).toContain('404');
    expect(logLine).toContain('not_found');
    expectNoSecretsLeaked(logLine);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('4) Nest 내장 HttpException(5xx: BadGatewayException) → error 로그(스택 포함)로 승격, 응답 바디 불변', () => {
    const exception = new BadGatewayException('업스트림 실패');
    const host = makeHost('POST', '/v1/publications/1/retry');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(502);
    expect(jsonMock).toHaveBeenCalledWith({
      code: 'internal',
      message: '업스트림 실패',
    } satisfies ApiError);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [logLine, stack] = errorSpy.mock.calls[0] as [string, string | undefined];
    expect(logLine).toContain('POST');
    expect(logLine).toContain('/v1/publications/1/retry');
    expect(logLine).toContain('502');
    expect(typeof stack).toBe('string');
    expectNoSecretsLeaked(logLine);
    // 5xx 승격 분기는 own warn을 호출하지 않는다
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('5) 그 외(일반 Error) → 500 로그 + 응답 바디 불변 (기존 동작, 회귀 확인용)', () => {
    const exception = new Error('DB 커넥션 폭발');
    const host = makeHost('GET', '/v1/anything');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      code: 'internal',
      message: '서버 내부 오류',
    } satisfies ApiError);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('처리되지 않은 예외', exception.stack);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
