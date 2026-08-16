import type {
  CreateContentDraftRequest,
  CultureTopic,
  LoginRequest,
  ProgramCategory,
  SceneInput,
} from '@gachinol/shared';
import { requiresCultureTopic } from '@gachinol/shared';
import { UploadMode } from './mode';

/**
 * 폼 검증 순수 함수 — 서버 zod 스키마 미러.
 * zod 미도입: shared는 런타임 의존성 0 원칙이라 zod를 끌어올 수 없고 api 스키마는 import 불가
 * → 수치 상수를 출처 주석으로 동기화한다.
 */

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; errors: Record<string, string> };

/** 장면 입력 폼 값 — 숫자 필드는 TextInput 원문(string), 빈칸=null */
export interface SceneFormValue {
  caption: string;
  description: string;
  startSec: string;
  endSec: string;
}

export const emptySceneForm = (): SceneFormValue => ({
  caption: '',
  description: '',
  startSec: '',
  endSec: '',
});

/** 분류·제목 폼 값 */
export interface ClassifyFormValue {
  title: string;
  description: string;
  category?: ProgramCategory;
  cultureTopics: readonly CultureTopic[];
}

export const emptyClassifyForm = (): ClassifyFormValue => ({
  title: '',
  description: '',
  category: undefined,
  cultureTopics: [],
});

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

/** '' → null / 숫자 문자열 → number / 그 외 → 'invalid' */
function parseSec(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return 'invalid';
  return n;
}

/**
 * 장면 검증.
 * 원천: services/api/src/contents/schemas/content.schemas.ts —
 *   scenes max(200) + order 0부터 연속·중복 금지 / caption min(1).max(500) /
 *   description max(2000) opt / startSec·endSec min(0).nullable()
 * order는 배열 인덱스로 자동 부여 → 연속·중복 규칙을 구조적으로 충족.
 * 최소 1개는 앱 정책(서버는 0개 허용) / end > start도 앱 정책(서버 미검증).
 */
export function validateScenes(scenes: readonly SceneFormValue[]): ValidationResult<SceneInput[]> {
  const errors: Record<string, string> = {};
  if (scenes.length < 1) {
    // 앱 정책 — 서버는 scenes 0개를 허용하지만 기자 워크플로우상 최소 1개를 요구한다
    return { ok: false, errors: { scenes: '장면을 1개 이상 추가해 주세요' } };
  }
  if (scenes.length > 200) {
    return { ok: false, errors: { scenes: '장면은 최대 200개까지 입력할 수 있습니다' } };
  }
  const value: SceneInput[] = [];
  scenes.forEach((scene, index) => {
    const key = (field: string): string => `scenes.${index}.${field}`;
    const caption = scene.caption.trim();
    if (!caption) errors[key('caption')] = '자막을 입력해 주세요';
    else if (caption.length > 500) errors[key('caption')] = '자막은 500자 이내로 입력해 주세요';
    const description = scene.description.trim();
    if (description.length > 2000) {
      errors[key('description')] = '설명은 2000자 이내로 입력해 주세요';
    }
    const startSec = parseSec(scene.startSec);
    const endSec = parseSec(scene.endSec);
    if (startSec === 'invalid' || (typeof startSec === 'number' && startSec < 0)) {
      errors[key('startSec')] = '시작 초는 0 이상의 숫자여야 합니다';
    }
    if (endSec === 'invalid' || (typeof endSec === 'number' && endSec < 0)) {
      errors[key('endSec')] = '끝 초는 0 이상의 숫자여야 합니다';
    }
    if (
      typeof startSec === 'number' &&
      typeof endSec === 'number' &&
      startSec >= 0 &&
      endSec >= 0 &&
      endSec <= startSec
    ) {
      // 앱 정책 — 서버는 end > start를 검증하지 않는다
      errors[key('endSec')] = '끝 초는 시작 초보다 커야 합니다';
    }
    value.push({
      order: index, // 배열 인덱스 파생 — 서버 "0부터 연속·중복 금지" 원천 차단
      caption,
      ...(description ? { description } : {}),
      startSec: typeof startSec === 'number' ? startSec : null,
      endSec: typeof endSec === 'number' ? endSec : null,
    });
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}

/**
 * 분류·제목 검증.
 * 원천: services/api/src/contents/schemas/content.schemas.ts —
 *   title min(1).max(200) / description max(5000) opt / category 6종 enum /
 *   culture ⇔ cultureTopics 1개 이상 (비culture면 금지 — UI가 자동 클리어)
 */
export function validateClassify(
  form: ClassifyFormValue,
): ValidationResult<Omit<CreateContentDraftRequest, 'scenes'>> {
  const errors: Record<string, string> = {};
  const title = form.title.trim();
  if (!title) errors.title = '제목을 입력해 주세요';
  else if (title.length > 200) errors.title = '제목은 200자 이내로 입력해 주세요';
  const description = form.description.trim();
  if (description.length > 5000) errors.description = '설명은 5000자 이내로 입력해 주세요';
  if (!form.category) errors.category = '분류를 선택해 주세요';
  else {
    if (requiresCultureTopic(form.category) && form.cultureTopics.length === 0) {
      errors.cultureTopics = '교양은 하위 토픽을 1개 이상 선택해 주세요';
    }
    if (!requiresCultureTopic(form.category) && form.cultureTopics.length > 0) {
      // UI가 culture 이탈 시 자동 클리어하므로 통상 도달 불가 — 방어적 검증
      errors.cultureTopics = '교양 외 분류는 하위 토픽을 선택할 수 없습니다';
    }
  }
  if (Object.keys(errors).length > 0 || !form.category) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      ...(description ? { description } : {}),
      category: form.category,
      ...(form.cultureTopics.length > 0 ? { cultureTopics: form.cultureTopics } : {}),
    },
  };
}

/**
 * 초안 저장 합성 검증 — 분류 + 장면 → CreateContentDraftRequest.
 *
 * ★ **두 모드가 실제로 갈라지는 유일한 지점**(T-W2-34, 대장 #123).
 * 간단 모드는 자막 화면을 아예 거치지 않으므로 장면 검증을 **건너뛰고 빈 배열로 저장**한다.
 * 서버는 `scenes` 빈 배열을 허용하며(`zCreateContentDraft`의 `z.array(zSceneInput).max(200)` —
 * `min` 없음), 주민 제보 콘텐츠가 이미 `scenes: []`로 생성돼 파이프라인을 완주하고 있다
 * (api `resident-links.service.ts`). 자막은 나중에 지사 담당자가
 * `PATCH /v1/contents/:id/captions`로 채운다.
 *
 * ⚠ 이 분기를 지우면(간단 모드도 `validateScenes`를 타게 하면) 간단 모드는 다시 정밀 모드와
 * 완전히 같은 항등함수가 된다 — 그것이 정확히 대장 #123이 지적한 결함이다.
 * `__tests__/validation.test.ts`가 그 회귀를 고정한다.
 */
export function validateCreateDraft(
  classify: ClassifyFormValue,
  scenes: readonly SceneFormValue[],
  mode: UploadMode,
): ValidationResult<CreateContentDraftRequest> {
  const classifyResult = validateClassify(classify);
  const scenesResult: ValidationResult<SceneInput[]> =
    mode === UploadMode.Simple ? { ok: true, value: [] } : validateScenes(scenes);
  if (!classifyResult.ok || !scenesResult.ok) {
    return {
      ok: false,
      errors: {
        ...(classifyResult.ok ? {} : classifyResult.errors),
        ...(scenesResult.ok ? {} : scenesResult.errors),
      },
    };
  }
  return { ok: true, value: { ...classifyResult.value, scenes: scenesResult.value } };
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

/** 원천: content.schemas.ts zRejectContent — note min(1).max(2000) */
export function validateRejectNote(note: string): ValidationResult<string> {
  const trimmed = note.trim();
  if (!trimmed) return { ok: false, errors: { note: '반려 사유를 입력해 주세요' } };
  if (trimmed.length > 2000) {
    return { ok: false, errors: { note: '반려 사유는 2000자 이내로 입력해 주세요' } };
  }
  return { ok: true, value: trimmed };
}
