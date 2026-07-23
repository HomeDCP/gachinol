import { ProgramCategory } from '@gachinol/shared';
import type { ChannelAccountId, CreateLiveSessionRequest, ProgramCategory as Category } from '@gachinol/shared';

/**
 * 라이브 생성 폼 검증 — shared 불변식(type='emergency' ⇔ scheduledAt=null)을 클라에서 사전 강제한다.
 * 서버가 최종 판정하지만(400 validation_failed) 어긋난 요청을 아예 막아 왕복을 줄인다.
 */

export const TITLE_MAX_LEN = 200;

export interface CreateLiveSessionInput {
  type: Category;
  title: string;
  /** ISO datetime 또는 null(긴급) */
  scheduledAt: string | null;
  targetChannelAccountIds: readonly ChannelAccountId[];
}

export interface CreateLiveSessionErrors {
  title?: string;
  scheduledAt?: string;
}

export interface CreateLiveSessionValidation {
  ok: boolean;
  errors: CreateLiveSessionErrors;
  /** ok일 때만 — 서버로 보낼 요청 */
  request?: CreateLiveSessionRequest;
}

function isValidDateTime(iso: string): boolean {
  return !Number.isNaN(new Date(iso).getTime());
}

export function validateCreateLiveSession(
  input: CreateLiveSessionInput,
): CreateLiveSessionValidation {
  const errors: CreateLiveSessionErrors = {};
  const title = input.title.trim();
  const isEmergency = input.type === ProgramCategory.Emergency;

  if (title.length === 0) {
    errors.title = '제목을 입력하세요';
  } else if (title.length > TITLE_MAX_LEN) {
    errors.title = `제목은 ${TITLE_MAX_LEN}자를 넘을 수 없습니다`;
  }

  if (isEmergency) {
    // 긴급 ⇔ scheduledAt=null
    if (input.scheduledAt !== null) {
      errors.scheduledAt = '긴급 라이브는 편성 시각을 지정할 수 없습니다';
    }
  } else {
    if (input.scheduledAt === null || input.scheduledAt.trim().length === 0) {
      errors.scheduledAt = '편성 시각을 지정하세요';
    } else if (!isValidDateTime(input.scheduledAt)) {
      errors.scheduledAt = '편성 시각 형식이 올바르지 않습니다';
    }
  }

  const ok = Object.keys(errors).length === 0;
  if (!ok) return { ok, errors };

  return {
    ok,
    errors,
    request: {
      type: input.type,
      title,
      scheduledAt: isEmergency ? null : input.scheduledAt,
      targetChannelAccountIds: input.targetChannelAccountIds,
    },
  };
}
