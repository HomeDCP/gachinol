import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiError, ApiErrorCode } from '@gachinol/shared';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { DomainException } from '../errors/domain.exception';

/** ApiErrorCode → HTTP status (봉투 래핑 금지 — 에러 바디가 곧 shared ApiError) */
const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid_transition: 409,
  internal: 500,
};

/** Nest 내장 HttpException status → ApiErrorCode (미매핑 4xx는 validation_failed로 수렴하지 않고 internal 방지용 보수 매핑) */
const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    // 1) ZodValidationPipe 실패 → validation_failed (details.issues = zod issue 배열)
    if (exception instanceof ZodValidationException) {
      const body: ApiError = {
        code: 'validation_failed',
        message: '요청 검증에 실패했습니다',
        details: { issues: exception.getZodError().issues },
      };
      res.status(400).json(body);
      return;
    }

    // 2) 도메인 예외 → 코드 그대로
    if (exception instanceof DomainException) {
      const body: ApiError = {
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      };
      res.status(STATUS_BY_CODE[exception.code]).json(body);
      return;
    }

    // 3) Prisma 알려진 에러 (서비스가 놓친 경우의 안전망)
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        const body: ApiError = { code: 'conflict', message: '고유 제약 조건 충돌' };
        res.status(409).json(body);
        return;
      }
      if (exception.code === 'P2025') {
        const body: ApiError = { code: 'not_found', message: '대상을 찾을 수 없습니다' };
        res.status(404).json(body);
        return;
      }
    }

    // 4) Nest 내장 HttpException (404 라우트 없음 등)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_BY_STATUS[status] ?? 'internal';
      const body: ApiError = { code, message: exception.message };
      res.status(status).json(body);
      return;
    }

    // 5) 그 외 전부 500 — message 일반화, 스택은 로그로만
    this.logger.error(
      '처리되지 않은 예외',
      exception instanceof Error ? exception.stack : String(exception),
    );
    const body: ApiError = { code: 'internal', message: '서버 내부 오류' };
    res.status(500).json(body);
  }
}
