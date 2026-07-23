import type { ChatMessage, ChatMessageId } from '@gachinol/shared';

/**
 * 채팅 목록 순수 헬퍼 — id dedupe + sentAt 오름차순 정렬(동시각은 id로 안정화).
 * 서버 recentChat(visible, 오름차순)로 시드하고 'chat.new'를 append, 'chat.moderated'(hidden)는 제거.
 * 낙관적 반영 없음 — ack/bro드캐스트가 유일 진실원(동일 개체라 send ack로도 dedupe됨).
 */

/** 표시 상한 — 장시간 방송에서 무한 성장 방지(오래된 앞쪽부터 절단) */
export const CHAT_DISPLAY_CAP = 300;

function insertSorted(list: readonly ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const next = list.filter((m) => m.id !== msg.id);
  next.push(msg);
  next.sort((a, b) => {
    if (a.sentAt !== b.sentAt) return a.sentAt < b.sentAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return next.length > CHAT_DISPLAY_CAP ? next.slice(next.length - CHAT_DISPLAY_CAP) : next;
}

/** recentChat 시드 — 이미 visible·오름차순이지만 방어적으로 정규화 */
export function seedChat(recent: readonly ChatMessage[]): ChatMessage[] {
  let acc: ChatMessage[] = [];
  for (const m of recent) {
    if (m.visibility === 'hidden') continue;
    acc = insertSorted(acc, m);
  }
  return acc;
}

/** 'chat.new' 수신 — visible만 반영(hidden 개체는 무시) */
export function appendChat(list: readonly ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (msg.visibility === 'hidden') return removeChat(list, msg.id);
  return insertSorted(list, msg);
}

/** 'chat.moderated'(hidden) — 해당 id 제거 */
export function removeChat(list: readonly ChatMessage[], id: ChatMessageId): ChatMessage[] {
  const next = list.filter((m) => m.id !== id);
  return next.length === list.length ? [...list] : next;
}
