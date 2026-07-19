/** REST 에러 응답·WS ack 실패 공용 에러 코드 */
export const ApiErrorCode = {
  ValidationFailed: 'validation_failed',
  Unauthorized: 'unauthorized',
  Forbidden: 'forbidden',
  NotFound: 'not_found',
  Conflict: 'conflict',
  /** 상태머신 전이 규칙 위반 (예: draft에서 바로 publishing 시도) */
  InvalidTransition: 'invalid_transition',
  Internal: 'internal',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** REST 에러 응답 바디 + WS ack 실패 페이로드 공용 */
export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}
