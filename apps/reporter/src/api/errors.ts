import type { ApiError, ApiErrorCode } from '@gachinol/shared';

/** 서버가 shared ApiError 계약으로 응답한 실패 (비2xx) */
export class ApiClientError extends Error {
  readonly status: number;
  readonly error: ApiError;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiClientError';
    this.status = status;
    this.error = error;
  }

  get code(): ApiErrorCode {
    return this.error.code;
  }
}

/** 네트워크 단절·타임아웃 — 서버 판정이 없으므로 세션을 태우지 않는다 */
export class ApiNetworkError extends Error {
  constructor(message = '서버에 연결할 수 없습니다', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ApiNetworkError';
  }
}

export const isApiClientError = (e: unknown): e is ApiClientError => e instanceof ApiClientError;

export const isApiNetworkError = (e: unknown): e is ApiNetworkError => e instanceof ApiNetworkError;

/**
 * 화면 공통 에러 문구 — 서버 `ApiError.message`가 1순위 (서버가 한국어 메시지를 관리).
 * code별 보조 문구는 message가 비었을 때의 폴백.
 */
export function userMessageForError(err: unknown): string {
  if (isApiClientError(err)) {
    if (err.error.message) return err.error.message;
    switch (err.code) {
      case 'unauthorized':
        return '로그인이 필요합니다';
      case 'forbidden':
        return '권한이 없습니다';
      case 'not_found':
        return '콘텐츠를 찾을 수 없습니다';
      case 'conflict':
      case 'invalid_transition':
        return '상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요';
      default:
        return '요청을 처리하지 못했습니다';
    }
  }
  if (isApiNetworkError(err)) return '서버에 연결할 수 없습니다';
  return '알 수 없는 오류가 발생했습니다';
}
