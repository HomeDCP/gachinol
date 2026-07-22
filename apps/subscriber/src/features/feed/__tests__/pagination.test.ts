import type { CursorPage, FeedItem } from '@gachinol/shared';
import { getNextPageParam } from '../queries';

function page(nextCursor: string | null): CursorPage<FeedItem> {
  return { items: [], nextCursor };
}

describe('getNextPageParam', () => {
  test('nextCursor 있으면 그 값', () => {
    expect(getNextPageParam(page('cursor-abc'))).toBe('cursor-abc');
  });
  test('nextCursor null → undefined (무한스크롤 종료)', () => {
    expect(getNextPageParam(page(null))).toBeUndefined();
  });
});
