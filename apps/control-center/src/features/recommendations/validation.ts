import type { ValidationResult } from '../contents/validation';

/**
 * 원천: services/api/src/recommendations/schemas/recommendation.schemas.ts
 *   zRequestRecommendationRevision — note min(1).max(2000)
 * (contents/validation.ts와 동일 규약 — zod 미도입, 수치 상수를 출처 주석으로 동기화)
 */
export const REVISION_NOTE_MAX_LEN = 2000;

export function validateRecommendationRevisionNote(note: string): ValidationResult<string> {
  const trimmed = note.trim();
  if (!trimmed) return { ok: false, errors: { note: '수정 요청 내용을 입력해 주세요' } };
  if (trimmed.length > REVISION_NOTE_MAX_LEN) {
    return { ok: false, errors: { note: '수정 요청은 2000자 이내로 입력해 주세요' } };
  }
  return { ok: true, value: trimmed };
}
