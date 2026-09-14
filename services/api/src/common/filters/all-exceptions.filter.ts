import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiError, ApiErrorCode } from '@gachinol/shared';
import type { Request, Response } from 'express';
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
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    // 1) ZodValidationPipe 실패 → validation_failed (details.issues = zod issue 배열)
    if (exception instanceof ZodValidationException) {
      const body: ApiError = {
        code: 'validation_failed',
        message: '요청 검증에 실패했습니다',
        details: { issues: exception.getZodError().issues },
      };
      this.warnClientError(400, body.code, body.message, req);
      res.status(400).json(body);
      return;
    }

    // 2) 도메인 예외 → 코드 그대로
    if (exception instanceof DomainException) {
      const status = STATUS_BY_CODE[exception.code];
      const body: ApiError = {
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      };
      // ⚠️ exception.details는 로그에 통째로 찍지 않는다(식별정보 가능성) — body에는 계약대로 그대로 담되
      // 관측성 로그는 status·code·message(= 응답으로 이미 나가는 값)까지만 남긴다.
      this.warnClientError(status, body.code, body.message, req);
      res.status(status).json(body);
      return;
    }

    // 3) Prisma 알려진 에러 (서비스가 놓친 경우의 안전망)
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        const body: ApiError = { code: 'conflict', message: '고유 제약 조건 충돌' };
        this.warnClientError(409, body.code, body.message, req);
        res.status(409).json(body);
        return;
      }
      if (exception.code === 'P2025') {
        const body: ApiError = { code: 'not_found', message: '대상을 찾을 수 없습니다' };
        this.warnClientError(404, body.code, body.message, req);
        res.status(404).json(body);
        return;
      }
    }

    // 4) Nest 내장 HttpException (404 라우트 없음 등)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_BY_STATUS[status] ?? 'internal';
      const body: ApiError = { code, message: exception.message };
      // Nest 내장 HttpException은 500대(예: InternalServerErrorException·BadGatewayException)도
      // 이 분기를 탄다 — 예상된 4xx 흐름이 아니라 실제 장애이므로 warn이 아니라 error로 가르고
      // 스택도 함께 남긴다(5번 분기와 동일 취급). 4xx만 warn·스택 없음.
      if (status >= 500) {
        this.logger.error(
          `${req.method} ${req.path} → ${status} ${code}: ${body.message}`,
          exception.stack,
        );
      } else {
        this.warnClientError(status, code, body.message, req);
      }
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

  /**
   * 4xx 관측성 로그 — status·code·method·path·message(= 응답 바디와 동일 텍스트)만 남긴다.
   * 요청 바디·헤더·쿠키·Authorization·쿼리스트링은 절대 넣지 않는다(req.path는 쿼리 제외).
   * 4xx는 예상된 흐름이라 warn이고 스택은 남기지 않는다.
   */
  private warnClientError(
    status: number,
    code: ApiErrorCode,
    message: string,
    req: Request,
  ): void {
    this.logger.warn(`${req.method} ${req.path} → ${status} ${code}: ${message}`);
  }
}
