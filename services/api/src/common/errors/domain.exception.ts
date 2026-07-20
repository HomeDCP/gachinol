import type { ApiErrorCode } from '@gachinol/shared';

/**
 * 서비스 계층이 던지는 유일한 예외 — HTTP 지식 없음.
 * HTTP status 매핑은 AllExceptionsFilter가 담당 (에러 계약 = shared ApiError).
 */
export class DomainException extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainException';
  }
}
