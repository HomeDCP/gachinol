import type { LoginRequest } from '@gachinol/shared';

/**
 * 폼 검증 순수 함수 — 서버 zod 스키마 미러.
 * zod 미도입: shared는 런타임 의존성 0 원칙이라 zod를 끌어올 수 없고 api 스키마는 import 불가
 * → 수치 상수를 출처 주석으로 동기화한다.
 */

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; errors: Record<string, string> };

// 원천: services/api/src/auth/schemas/auth.schemas.ts — email ≤320 / password 1..200
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin(email: string, password: string): ValidationResult<LoginRequest> {
  const errors: Record<string, string> = {};
  const trimmedEmail = email.trim();
  if (!trimmedEmail) errors.email = '이메일을 입력해 주세요';
  else if (trimmedEmail.length > 320 || !EMAIL_RE.test(trimmedEmail)) {
    errors.email = '올바른 이메일 형식이 아닙니다';
  }
  if (password.length < 1) errors.password = '비밀번호를 입력해 주세요';
  else if (password.length > 200) errors.password = '비밀번호가 너무 깁니다';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { email: trimmedEmail, password } };
}

/** 원천: content.schemas.ts zCreateRevisionRequestBody — note min(1).max(2000) */
export function validateRevisionNote(note: string): ValidationResult<string> {
  const trimmed = note.trim();
  if (!trimmed) return { ok: false, errors: { note: '수정 요청 내용을 입력해 주세요' } };
  if (trimmed.length > 2000) {
    return { ok: false, errors: { note: '수정 요청은 2000자 이내로 입력해 주세요' } };
  }
  return { ok: true, value: trimmed };
}

/** 원천: content.schemas.ts zCreateRevisionRequestBody — sceneNotes[].note min(1).max(1000) */
export function validateSceneNote(note: string): ValidationResult<string> {
  const trimmed = note.trim();
  if (!trimmed) return { ok: false, errors: { note: '장면 노트를 입력해 주세요' } };
  if (trimmed.length > 1000) {
    return { ok: false, errors: { note: '장면 노트는 1000자 이내로 입력해 주세요' } };
  }
  return { ok: true, value: trimmed };
}

/** 원천: content.schemas.ts zRejectContent — note min(1).max(2000) */
export function validateRejectNote(note: string): ValidationResult<string> {
  const trimmed = note.trim();
  if (!trimmed) return { ok: false, errors: { note: '반려 사유를 입력해 주세요' } };
  if (trimmed.length > 2000) {
    return { ok: false, errors: { note: '반려 사유는 2000자 이내로 입력해 주세요' } };
  }
  return { ok: true, value: trimmed };
}
