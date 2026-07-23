import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { centerOperatorUser, chatMessageRow, makePrismaMock } from '../test-support/fixtures';
import { ChatService } from './chat.service';
import type { LiveBroadcaster } from './live.broadcaster';

const configMock = { get: () => 50 } as unknown as ConfigService<Env, true>;

const setup = () => {
  const prisma = makePrismaMock();
  const broadcaster = { emitChatModerated: jest.fn() } as unknown as LiveBroadcaster;
  return { prisma, broadcaster, service: new ChatService(prisma, configMock, broadcaster) };
};

describe('ChatService', () => {
  it('persist — visibility=visible, 익명 guestId 저장', async () => {
    const { prisma, service } = setup();
    prisma.chatMessage.create.mockImplementation(async ({ data }: any) => data);
    const row = await service.persist({
      liveSessionId: 'live-1',
      userId: 'guest-abc',
      userName: '익명1234',
      message: '안녕',
    });
    expect(row.visibility).toBe('visible');
    expect(row.userId).toBe('guest-abc');
  });

  it('recentVisible — visible만, sentAt desc 조회 후 reverse(오름차순)', async () => {
    const { prisma, service } = setup();
    prisma.chatMessage.findMany.mockResolvedValue([chatMessageRow({ id: 'b' }), chatMessageRow({ id: 'a' })]);
    const rows = await service.recentVisible('live-1');
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { liveSessionId: 'live-1', visibility: 'visible' },
        orderBy: { sentAt: 'desc' },
        take: 50,
      }),
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  describe('hide (모더레이션)', () => {
    it('세션 불일치/부재 → not_found', async () => {
      const { prisma, service } = setup();
      prisma.chatMessage.findUnique.mockResolvedValue(chatMessageRow({ liveSessionId: 'other' }));
      await expect(service.hide('live-1', 'chat-1', centerOperatorUser())).rejects.toMatchObject({ code: 'not_found' });
    });

    it('이미 hidden(count=0) → conflict', async () => {
      const { prisma, service } = setup();
      prisma.chatMessage.findUnique.mockResolvedValue(chatMessageRow());
      prisma.chatMessage.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.hide('live-1', 'chat-1', centerOperatorUser())).rejects.toMatchObject({ code: 'conflict' });
    });

    it('정상 — visible→hidden CAS + chat.moderated 브로드캐스트', async () => {
      const { prisma, broadcaster, service } = setup();
      prisma.chatMessage.findUnique
        .mockResolvedValueOnce(chatMessageRow())
        .mockResolvedValueOnce(chatMessageRow({ visibility: 'hidden', moderatedByUserId: 'u-center' }));
      prisma.chatMessage.updateMany.mockResolvedValue({ count: 1 });
      const row = await service.hide('live-1', 'chat-1', centerOperatorUser());
      expect(prisma.chatMessage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'chat-1', visibility: 'visible' },
          data: expect.objectContaining({ visibility: 'hidden', moderatedByUserId: 'u-center' }),
        }),
      );
      expect(broadcaster.emitChatModerated).toHaveBeenCalledWith(
        expect.objectContaining({ chatMessageId: 'chat-1', visibility: 'hidden' }),
      );
      expect(row.visibility).toBe('hidden');
    });
  });
});
