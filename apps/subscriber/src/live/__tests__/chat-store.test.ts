import { toId } from '@gachinol/shared';
import type { ChatMessage, ChatMessageId, ChatVisibility } from '@gachinol/shared';
import { appendChat, CHAT_DISPLAY_CAP, removeChat, seedChat } from '../chat-store';

function msg(over: {
  id: string;
  sentAt: string;
  message?: string;
  visibility?: ChatVisibility;
}): ChatMessage {
  return {
    id: toId<ChatMessageId>(over.id),
    liveSessionId: toId('live1'),
    userId: toId('u1'),
    userName: '삼춘',
    message: over.message ?? 'hi',
    visibility: over.visibility ?? 'visible',
    moderatedByUserId: null,
    sentAt: over.sentAt,
  };
}

describe('chat-store', () => {
  test('seedChat: hidden 제외 + sentAt 오름차순 정렬', () => {
    const out = seedChat([
      msg({ id: 'b', sentAt: '2026-07-23T10:00:02.000Z' }),
      msg({ id: 'a', sentAt: '2026-07-23T10:00:01.000Z' }),
      msg({ id: 'h', sentAt: '2026-07-23T10:00:03.000Z', visibility: 'hidden' }),
    ]);
    expect(out.map((m) => m.id)).toEqual(['a', 'b']);
  });

  test('appendChat: id dedupe(같은 id 재수신은 교체, 중복 없음)', () => {
    const base = seedChat([msg({ id: 'a', sentAt: '2026-07-23T10:00:01.000Z' })]);
    const next = appendChat(base, msg({ id: 'a', sentAt: '2026-07-23T10:00:01.000Z', message: 'edited' }));
    expect(next).toHaveLength(1);
    expect(next[0]!.message).toBe('edited');
  });

  test('appendChat: 동시각은 id로 안정 정렬', () => {
    let list = seedChat([]);
    list = appendChat(list, msg({ id: 'z', sentAt: '2026-07-23T10:00:00.000Z' }));
    list = appendChat(list, msg({ id: 'a', sentAt: '2026-07-23T10:00:00.000Z' }));
    expect(list.map((m) => m.id)).toEqual(['a', 'z']);
  });

  test('appendChat: hidden 개체 수신은 목록에서 제거 취급', () => {
    let list = seedChat([msg({ id: 'a', sentAt: '2026-07-23T10:00:01.000Z' })]);
    list = appendChat(list, msg({ id: 'a', sentAt: '2026-07-23T10:00:01.000Z', visibility: 'hidden' }));
    expect(list).toHaveLength(0);
  });

  test('removeChat: id 제거(없으면 동일 내용 새 배열)', () => {
    const list = seedChat([
      msg({ id: 'a', sentAt: '2026-07-23T10:00:01.000Z' }),
      msg({ id: 'b', sentAt: '2026-07-23T10:00:02.000Z' }),
    ]);
    expect(removeChat(list, 'a' as ChatMessage['id']).map((m) => m.id)).toEqual(['b']);
    expect(removeChat(list, 'zzz' as ChatMessage['id']).map((m) => m.id)).toEqual(['a', 'b']);
  });

  test('표시 상한 — CHAP_DISPLAY_CAP 초과 시 앞쪽(오래된) 절단', () => {
    let list = seedChat([]);
    for (let i = 0; i < CHAT_DISPLAY_CAP + 20; i++) {
      const ts = new Date(1_800_000_000_000 + i * 1000).toISOString();
      list = appendChat(list, msg({ id: `m${String(i).padStart(4, '0')}`, sentAt: ts }));
    }
    expect(list).toHaveLength(CHAT_DISPLAY_CAP);
    // 가장 오래된 20개가 잘려나감
    expect(list[0]!.id).toBe('m0020');
  });
});
