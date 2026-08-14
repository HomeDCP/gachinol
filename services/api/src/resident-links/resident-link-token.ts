import { createHash, randomBytes } from 'node:crypto';

/* ══════════════════════════════════════════════════════════════════════════
 * 링크 토큰 — 이 값 하나가 **인증 전체**를 대신한다(무인증 업로드 경로).
 *
 * ① **추측 불가능**: CSPRNG 32바이트(=256비트) → base64url 43자. 순차 id·타임스탬프 기반·짧은 코드는
 *    금지다(하나가 유출되면 이웃 링크를 열거할 수 있게 된다).
 * ② **원문 미저장**: DB에는 sha256 해시만 넣는다(`refresh_tokens.token_hash` 선례). 원문은 발급
 *    응답으로 1회만 나가며 서버 어디에도 남지 않는다 — DB 백업·덤프가 유출돼도 유효 링크를 복원할 수 없다.
 *    (조회는 해시 컬럼의 UNIQUE 인덱스 동등 검색이라 원문 저장 없이도 O(1)이다.)
 * ③ **해시에 salt를 쓰지 않는 이유**: 토큰은 사용자 선택 비밀번호가 아니라 256비트 고엔트로피 난수라
 *    사전·무차별 대입이 성립하지 않는다. 여기서 argon2를 쓰면 조회마다 KDF 비용만 지불하고
 *    (같은 이유로 refresh 토큰도 sha256이다) 검색 가능한 결정적 해시라는 요건도 깨진다.
 * ══════════════════════════════════════════════════════════════════════════ */

/** 토큰 엔트로피 — 32바이트(256비트) */
export const RESIDENT_LINK_TOKEN_BYTES = 32;

/**
 * 경로 세그먼트로 그대로 쓰이므로 URL-safe 문자만 허용한다(base64url).
 * 32바이트 → 43자이지만, 길이를 정확히 한 값으로 못박으면 토큰 길이 조정이 스키마 변경이 되므로
 * 40~64자 범위로 둔다(형식 검사의 목적은 "DB 조회 전 명백한 쓰레기 걸러내기"다).
 */
export const RESIDENT_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

/** 발급 — 호출자는 반환값을 **응답에 1회 싣고 즉시 버린다**(로그 금지) */
export const generateResidentLinkToken = (): string =>
  randomBytes(RESIDENT_LINK_TOKEN_BYTES).toString('base64url');

/** DB 조회·저장 키 — sha256 hex(64자). 같은 원문은 항상 같은 해시(결정적 조회) */
export const hashResidentLinkToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/** DB를 때리기 전의 형식 검사 — 실패는 "없는 링크"와 동일하게 취급한다(존재 여부 오라클 차단) */
export const isResidentLinkTokenShape = (token: string): boolean =>
  RESIDENT_LINK_TOKEN_PATTERN.test(token);
