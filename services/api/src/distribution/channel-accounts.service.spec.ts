import { DomainException } from '../common/errors/domain.exception';
import { channelAccountRow, contentRow, makePrismaMock } from '../test-support/fixtures';
import { ChannelAccountsService } from './channel-accounts.service';

const expectConflict = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(DomainException);
  expect((err as DomainException).code).toBe('conflict');
};

describe('ChannelAccountsService.resolveTargets', () => {
  const setup = () => {
    const prisma = makePrismaMock();
    return { prisma, service: new ChannelAccountsService(prisma) };
  };

  it('① body override 우선 — 지정 채널만(존재분)', async () => {
    const { prisma, service } = setup();
    const ch = channelAccountRow({ id: 'ch-x', externalChannelId: 'kakao-x' });
    prisma.channelAccount.findMany.mockResolvedValue([ch]);
    const content = contentRow({ targetChannelAccountIds: ['ch-target'] as never });
    const out = await service.resolveTargets(content, ['ch-x']);
    expect(out.map((c) => c.id)).toEqual(['ch-x']);
    // override 경로는 findByIds(in) 사용 — 지사 기본 쿼리 미사용
    expect(prisma.channelAccount.findMany).toHaveBeenCalledWith({ where: { id: { in: ['ch-x'] } } });
  });

  it('② override 없으면 content.targetChannelAccountIds', async () => {
    const { prisma, service } = setup();
    const ch = channelAccountRow({ id: 'ch-t' });
    prisma.channelAccount.findMany.mockResolvedValue([ch]);
    const content = contentRow({ targetChannelAccountIds: ['ch-t'] as never });
    const out = await service.resolveTargets(content);
    expect(out.map((c) => c.id)).toEqual(['ch-t']);
    expect(prisma.channelAccount.findMany).toHaveBeenCalledWith({ where: { id: { in: ['ch-t'] } } });
  });

  it('③ 둘 다 비면 지사 connected kakao 기본 규칙', async () => {
    const { prisma, service } = setup();
    prisma.channelAccount.findMany.mockResolvedValue([channelAccountRow()]);
    const content = contentRow({ targetChannelAccountIds: [] as never });
    const out = await service.resolveTargets(content);
    expect(out).toHaveLength(1);
    expect(prisma.channelAccount.findMany).toHaveBeenCalledWith({
      where: { stationId: 's-aewol', platform: 'kakao', status: 'connected' },
    });
  });

  it('connected 아니거나 vod_publish 미보유 채널 제외', async () => {
    const { prisma, service } = setup();
    prisma.channelAccount.findMany.mockResolvedValue([
      channelAccountRow({ id: 'ok', status: 'connected', capabilities: ['vod_publish'] }),
      channelAccountRow({ id: 'expired', status: 'expired', capabilities: ['vod_publish'] }),
      channelAccountRow({ id: 'nocap', status: 'connected', capabilities: [] }),
    ]);
    const out = await service.resolveTargets(contentRow(), ['ok', 'expired', 'nocap']);
    expect(out.map((c) => c.id)).toEqual(['ok']);
  });

  it('해석 0건 → conflict', async () => {
    const { prisma, service } = setup();
    prisma.channelAccount.findMany.mockResolvedValue([]);
    await expectConflict(service.resolveTargets(contentRow({ targetChannelAccountIds: [] as never })));
  });

  it('중복 채널 제거(같은 채널 이중 송출 방지)', async () => {
    const { prisma, service } = setup();
    const ch = channelAccountRow({ id: 'dup' });
    prisma.channelAccount.findMany.mockResolvedValue([ch]);
    const out = await service.resolveTargets(contentRow(), ['dup', 'dup']);
    expect(out.map((c) => c.id)).toEqual(['dup']);
  });
});
