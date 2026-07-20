import * as argon2 from 'argon2';

/**
 * argon2id 파라미터 — 라이브러리 기본값(OWASP 권고 상회)을 상수로 고정.
 * 서버 사양 확정 시 이 파일만 조정한다.
 */
export const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
};
