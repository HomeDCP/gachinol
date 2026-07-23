import { Platform } from '@gachinol/shared';
import { CommentMockAdapter } from './comment-mock.adapter';

describe('CommentMockAdapter (결정적 목)', () => {
  it('결정적 externalCommentId·postedAt 단조 증가', async () => {
    const a = new CommentMockAdapter(Platform.Youtube);
    const { comments } = await a.poll({ externalChannelId: 'yt-chan', credentialRef: 'k' });
    expect(comments.length).toBe(5);
    expect(comments[0]!.externalCommentId).toBe('youtube-yt-chan-1');
    expect(comments[4]!.externalCommentId).toBe('youtube-yt-chan-5');
    // postedAt 단조 증가
    for (let i = 1; i < comments.length; i++) {
      expect(Date.parse(comments[i]!.postedAt)).toBeGreaterThan(Date.parse(comments[i - 1]!.postedAt));
    }
  });

  it('재-poll은 동일 집합(cursor 무관 → DB dedup 신뢰)', async () => {
    const a = new CommentMockAdapter(Platform.X);
    const first = await a.poll({ externalChannelId: 'c', credentialRef: 'k' });
    const second = await a.poll({ externalChannelId: 'c', credentialRef: 'k', sinceCursor: '5' });
    expect(second.comments.map((c) => c.externalCommentId)).toEqual(
      first.comments.map((c) => c.externalCommentId),
    );
  });

  it('N번째(seq%3===0)는 isQuestion=true', async () => {
    const a = new CommentMockAdapter(Platform.Threads);
    const { comments } = await a.poll({ externalChannelId: 'c', credentialRef: 'k' });
    expect(comments[2]!.isQuestion).toBe(true); // seq=3
    expect(comments[0]!.isQuestion).toBe(false);
  });

  it("fail- 접두 채널 → throw(수집 실패 경로)", async () => {
    const a = new CommentMockAdapter(Platform.Facebook);
    await expect(a.poll({ externalChannelId: 'fail-boom', credentialRef: 'k' })).rejects.toThrow();
  });

  it('platform이 externalCommentId·message에 반영', async () => {
    const a = new CommentMockAdapter(Platform.Instagram);
    const { comments } = await a.poll({ externalChannelId: 'ig', credentialRef: 'k' });
    expect(comments[0]!.externalCommentId).toContain('instagram-');
    expect(comments[0]!.message).toContain('[instagram]');
  });
});
