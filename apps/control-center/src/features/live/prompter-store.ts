import type { LiveComment, LiveCommentId } from '@gachinol/shared';

/**
 * 프롬프터 댓글 순수 헬퍼 — id dedupe + postedAt 오름차순(동시각은 id 안정화).
 * PrompterJoinAck.recentComments(오름차순)로 시드하고 'prompter.comments' 배치를 누적한다.
 * 아나운서는 시간순으로 읽되(오름차순), 질문(isQuestion)은 selectQuestions로 별도 강조.
 */

/** 표시 상한 — 장시간 방송 방어(오래된 앞쪽 절단) */
export const PROMPTER_DISPLAY_CAP = 500;

function sortKey(a: LiveComment, b: LiveComment): number {
  if (a.postedAt !== b.postedAt) return a.postedAt < b.postedAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 배치 병합 — 기존 + 신규를 id dedupe(신규 우선) 후 정렬·절단 */
export function mergePrompterComments(
  list: readonly LiveComment[],
  incoming: readonly LiveComment[],
): LiveComment[] {
  if (incoming.length === 0) return [...list];
  const byId = new Map<LiveCommentId, LiveComment>();
  for (const c of list) byId.set(c.id, c);
  for (const c of incoming) byId.set(c.id, c); // 신규가 이김(상태 갱신 반영)
  const merged = Array.from(byId.values()).sort(sortKey);
  return merged.length > PROMPTER_DISPLAY_CAP
    ? merged.slice(merged.length - PROMPTER_DISPLAY_CAP)
    : merged;
}

/** 시드 — 이미 오름차순이지만 방어적으로 정규화 */
export function seedPrompterComments(recent: readonly LiveComment[]): LiveComment[] {
  return mergePrompterComments([], recent);
}

/** 질문만 (오름차순 유지) — 아나announcer 우선 응답 후보 패널 */
export function selectQuestions(list: readonly LiveComment[]): LiveComment[] {
  return list.filter((c) => c.isQuestion === true);
}
