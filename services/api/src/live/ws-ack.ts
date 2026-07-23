import { Logger } from '@nestjs/common';
import type { ApiError, WsAck } from '@gachinol/shared';
import { DomainException } from '../common/errors/domain.exception';

/**
 * WS ack 직렬화 — 전역 AllExceptionsFilter는 switchToHttp를 무조건 호출해 WS에 부적합하므로
 * 각 핸들러가 try/catch로 이 헬퍼를 통해 ack을 통일한다(ack이 계약상 오류 채널).
 * DomainException → {ok:false, error:ApiError}(REST와 동일 계약), 그 외 → internal.
 */
const logger = new Logger('WsAck');

export const wsOk = <T>(data: T): WsAck<T> => ({ ok: true, data });

export const wsError = <T>(e: unknown): WsAck<T> => {
  if (e instanceof DomainException) {
    const error: ApiError = { code: e.code, message: e.message };
    if (e.details) error.details = e.details;
    return { ok: false, error };
  }
  logger.error(`WS 핸들러 내부 오류: ${e instanceof Error ? e.message : String(e)}`);
  return { ok: false, error: { code: 'internal', message: '서버 내부 오류' } };
};
