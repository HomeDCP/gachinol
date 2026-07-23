/** 닉네임 정제 — 서버(LiveGateway.sanitizeNickname)와 동일 규칙: trim + 40자 컷. */
export const NICKNAME_MAX_LEN = 40;

export function sanitizeNickname(raw: string): string {
  return raw.trim().slice(0, NICKNAME_MAX_LEN);
}

/** 입력 폼 검증 — 비어있지 않아야 채팅 참여 가능. 서버는 빈값이면 '익명NNNN'을 배정한다. */
export function isValidNickname(raw: string): boolean {
  return sanitizeNickname(raw).length > 0;
}
