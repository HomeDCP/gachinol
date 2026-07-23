import type { ConfigService } from '@nestjs/config';
import type { ChannelAccountsService } from '../distribution/channel-accounts.service';
import type { Env } from '../config/env.schema';
import { channelAccountRow, liveCommentRow, liveSessionRow } from '../test-support/fixtures';
import type { CommentSourceRegistry } from './adapters/comment-source.registry';
import { CommentCollectorService } from './comment-collector.service';
import type { LiveBroadcaster } from './live.broadcaster';
import type { LiveCommentsService } from './live-comments.service';
import type { LiveSessionsService } from './live-sessions.service';

const configMock = { get: () => 3000 } as unknown as ConfigService<Env, true>;

const setup = () => {
  const sessions = { findById: jest.fn() } as unknown as jest.Mocked<LiveSessionsService>;
  const channels = { findByIds: jest.fn() } as unknown as jest.Mocked<ChannelAccountsService>;
  const comments = {
    normalize: jest.fn((raw: any) => ({ id: raw.externalCommentId, externalCommentId: raw.externalCommentId })),
    persistMany: jest.fn().mockResolvedValue(undefined),
    fetchUnprompted: jest.fn().mockResolvedValue([]),
    markPrompted: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<LiveCommentsService>;
  const broadcaster = { emitPrompterComments: jest.fn() } as unknown as LiveBroadcaster;
  const pollFn = jest.fn();
  const registry = { get: jest.fn(() => ({ poll: pollFn })) } as unknown as CommentSourceRegistry;
  const service = new CommentCollectorService(configMock, sessions, channels, comments, broadcaster, registry);
  return { service, sessions, channels, comments, broadcaster, registry, pollFn };
};

describe('CommentCollectorService.collectOnce', () => {
  it('세션이 live 아니면 0 (수집 안 함)', async () => {
    const { service, sessions, channels } = setup();
    sessions.findById.mockResolvedValue(liveSessionRow({ status: 'scheduled' }) as never);
    expect(await service.collectOnce('live-1')).toBe(0);
    expect(channels.findByIds).not.toHaveBeenCalled();
  });

  it('comment_read 채널만 poll — 미보유 채널은 skip', async () => {
    const { service, sessions, channels, pollFn } = setup();
    sessions.findById.mockResolvedValue(
      liveSessionRow({ status: 'live', targetChannelAccountIds: ['ch-yt', 'ch-kakao'] }) as never,
    );
    channels.findByIds.mockResolvedValue(
      new Map([
        ['ch-yt', channelAccountRow({ id: 'ch-yt', platform: 'youtube', capabilities: ['comment_read'] })],
        ['ch-kakao', channelAccountRow({ id: 'ch-kakao', platform: 'kakao', capabilities: ['vod_publish'] })],
      ]),
    );
    pollFn.mockResolvedValue({ comments: [] });
    await service.collectOnce('live-1');
    // comment_read 채널(youtube) 1개만 poll
    expect(pollFn).toHaveBeenCalledTimes(1);
  });

  it('신규 collected → emitPrompterComments + markPrompted, 재호출은 0(dedup)', async () => {
    const { service, sessions, channels, comments, broadcaster, pollFn } = setup();
    sessions.findById.mockResolvedValue(
      liveSessionRow({ status: 'live', targetChannelAccountIds: ['ch-yt'] }) as never,
    );
    channels.findByIds.mockResolvedValue(
      new Map([['ch-yt', channelAccountRow({ id: 'ch-yt', platform: 'youtube', capabilities: ['comment_read'] })]]),
    );
    pollFn.mockResolvedValue({
      comments: [{ externalCommentId: 'yt-1', authorName: 'a', message: 'm', postedAt: '2026-07-25T10:00:00Z' }],
    });
    // 1회차: fetchUnprompted가 신규 1건
    (comments.fetchUnprompted as jest.Mock).mockResolvedValueOnce([liveCommentRow({ id: 'lc-1' })]);
    const n1 = await service.collectOnce('live-1');
    expect(n1).toBe(1);
    expect(broadcaster.emitPrompterComments).toHaveBeenCalledTimes(1);
    expect(comments.markPrompted).toHaveBeenCalledWith(['lc-1']);

    // 2회차: fetchUnprompted가 0건(이미 prompted) → 푸시 없음
    (comments.fetchUnprompted as jest.Mock).mockResolvedValueOnce([]);
    const n2 = await service.collectOnce('live-1');
    expect(n2).toBe(0);
    expect(broadcaster.emitPrompterComments).toHaveBeenCalledTimes(1); // 증가 없음
  });

  it('채널 poll 실패는 흡수하고 계속(per-channel catch)', async () => {
    const { service, sessions, channels, comments, pollFn } = setup();
    sessions.findById.mockResolvedValue(
      liveSessionRow({ status: 'live', targetChannelAccountIds: ['ch-yt'] }) as never,
    );
    channels.findByIds.mockResolvedValue(
      new Map([['ch-yt', channelAccountRow({ id: 'ch-yt', platform: 'youtube', capabilities: ['comment_read'] })]]),
    );
    pollFn.mockRejectedValue(new Error('SNS 다운'));
    await expect(service.collectOnce('live-1')).resolves.toBe(0);
    expect(comments.persistMany).toHaveBeenCalledWith([]); // 정규화 0건이라도 호출은 안전
  });
});

describe('CommentCollectorService arm/disarm (이벤트-암드)', () => {
  it('첫 arm에 인터벌 기동, 활성 0이면 정지', () => {
    const setSpy = jest.spyOn(global, 'setInterval');
    const clearSpy = jest.spyOn(global, 'clearInterval');
    const { service } = setup();
    service.arm('live-1');
    expect(setSpy).toHaveBeenCalledTimes(1);
    // 두 번째 arm은 인터벌 재생성 안 함
    service.arm('live-2');
    expect(setSpy).toHaveBeenCalledTimes(1);
    // 하나 disarm — 아직 활성 존재 → 유지
    service.disarm('live-1');
    expect(clearSpy).not.toHaveBeenCalled();
    // 마지막 disarm → 정지
    service.disarm('live-2');
    expect(clearSpy).toHaveBeenCalledTimes(1);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it('onModuleDestroy — 타이머 정리', () => {
    const clearSpy = jest.spyOn(global, 'clearInterval');
    const { service } = setup();
    service.arm('live-1');
    service.onModuleDestroy();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
