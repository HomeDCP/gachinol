import { toId } from '@gachinol/shared';
import type { LiveComment, LiveCommentId, Platform } from '@gachinol/shared';
import {
  mergePrompterComments,
  PROMPTER_DISPLAY_CAP,
  seedPrompterComments,
  selectQuestions,
} from '../prompter-store';

function comment(over: {
  id: string;
  postedAt: string;
  isQuestion?: boolean;
  platform?: Platform;
  message?: string;
}): LiveComment {
  return {
    id: toId<LiveCommentId>(over.id),
    liveSessionId: toId('live1'),
    channelAccountId: toId('ch1'),
    platform: over.platform ?? 'youtube',
    externalCommentId: `ext-${over.id}`,
    authorName: '시청자',
    message: over.message ?? 'hi',
    isQuestion: over.isQuestion,
    status: 'collected',
    postedAt: over.postedAt,
    collectedAt: over.postedAt,
  };
}

describe('prompter-store', () => {
  test('seed + merge: postedAt 오름차순 정렬', () => {
    const seeded = seedPrompterComments([
      comment({ id: 'b', postedAt: '2026-07-23T10:00:02.000Z' }),
      comment({ id: 'a', postedAt: '2026-07-23T10:00:01.000Z' }),
    ]);
    expect(seeded.map((c) => c.id)).toEqual(['a', 'b']);
  });

  test('merge: id dedupe(신규가 이김) + 누적 정렬', () => {
    let list = seedPrompterComments([comment({ id: 'a', postedAt: '2026-07-23T10:00:01.000Z' })]);
    list = mergePrompterComments(list, [
      comment({ id: 'a', postedAt: '2026-07-23T10:00:01.000Z', message: 'updated' }),
      comment({ id: 'c', postedAt: '2026-07-23T10:00:03.000Z' }),
      comment({ id: 'b', postedAt: '2026-07-23T10:00:02.000Z' }),
    ]);
    expect(list.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(list[0]!.message).toBe('updated');
  });

  test('merge: 빈 배치는 동일 내용 복사', () => {
    const list = seedPrompterComments([comment({ id: 'a', postedAt: '2026-07-23T10:00:01.000Z' })]);
    expect(mergePrompterComments(list, []).map((c) => c.id)).toEqual(['a']);
  });

  test('동시각은 id로 안정 정렬', () => {
    const list = mergePrompterComments(
      [],
      [
        comment({ id: 'z', postedAt: '2026-07-23T10:00:00.000Z' }),
        comment({ id: 'a', postedAt: '2026-07-23T10:00:00.000Z' }),
      ],
    );
    expect(list.map((c) => c.id)).toEqual(['a', 'z']);
  });

  test('selectQuestions: isQuestion만, 오름차순 유지', () => {
    const list = mergePrompterComments(
      [],
      [
        comment({ id: 'a', postedAt: '2026-07-23T10:00:01.000Z' }),
        comment({ id: 'q1', postedAt: '2026-07-23T10:00:02.000Z', isQuestion: true }),
        comment({ id: 'q2', postedAt: '2026-07-23T10:00:03.000Z', isQuestion: true }),
      ],
    );
    expect(selectQuestions(list).map((c) => c.id)).toEqual(['q1', 'q2']);
  });

  test('표시 상한 초과 시 오래된 앞쪽 절단', () => {
    const batch: LiveComment[] = [];
    for (let i = 0; i < PROMPTER_DISPLAY_CAP + 10; i++) {
      batch.push(
        comment({ id: `c${String(i).padStart(4, '0')}`, postedAt: new Date(1_800_000_000_000 + i * 1000).toISOString() }),
      );
    }
    const list = mergePrompterComments([], batch);
    expect(list).toHaveLength(PROMPTER_DISPLAY_CAP);
    expect(list[0]!.id).toBe('c0010');
  });
});
