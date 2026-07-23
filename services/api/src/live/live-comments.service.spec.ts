import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { liveCommentRow, makePrismaMock } from '../test-support/fixtures';
import { LiveCommentsService, looksLikeQuestion } from './live-comments.service';

const configMock = { get: () => 50 } as unknown as ConfigService<Env, true>;

const setup = () => {
  const prisma = makePrismaMock();
  return { prisma, service: new LiveCommentsService(prisma, configMock) };
};

describe('looksLikeQuestion', () => {
  it('물음표 포함 → true', () => {
    expect(looksLikeQuestion('내일 날씨 어떤가요?')).toBe(true);
  });
  it('의문 종결어미 → true', () => {
    expect(looksLikeQuestion('이장님 물때 맞나요')).toBe(true);
  });
  it('평서문 → false', () => {
    expect(looksLikeQuestion('방송 잘 보고 있습니다')).toBe(false);
  });
});

describe('LiveCommentsService', () => {
  it('normalize — isQuestion raw 우선, 없으면 휴리스틱', () => {
    const { service } = setup();
    const ctx = { liveSessionId: 'live-1', channelAccountId: 'ch-x', platform: 'youtube' };
    const withRaw = service.normalize(
      { externalCommentId: 'e1', authorName: 'a', message: '평서문', isQuestion: true, postedAt: '2026-07-25T10:00:00Z' },
      ctx,
    );
    expect(withRaw.isQuestion).toBe(true);
    expect(withRaw.status).toBe('collected');
    expect(withRaw.liveSessionId).toBe('live-1');

    const heuristic = service.normalize(
      { externalCommentId: 'e2', authorName: 'a', message: '이거 맞나요?', postedAt: '2026-07-25T10:00:00Z' },
      ctx,
    );
    expect(heuristic.isQuestion).toBe(true);
  });

  it('persistMany — createMany skipDuplicates(멱등 dedup)', async () => {
    const { prisma, service } = setup();
    await service.persistMany([
      service.normalize(
        { externalCommentId: 'e1', authorName: 'a', message: 'm', postedAt: '2026-07-25T10:00:00Z' },
        { liveSessionId: 'live-1', channelAccountId: 'ch-x', platform: 'youtube' },
      ),
    ]);
    expect(prisma.liveComment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('persistMany — 빈 배열은 no-op', async () => {
    const { prisma, service } = setup();
    await service.persistMany([]);
    expect(prisma.liveComment.createMany).not.toHaveBeenCalled();
  });

  it('fetchUnprompted — collected만 postedAt 오름차순', async () => {
    const { prisma, service } = setup();
    prisma.liveComment.findMany.mockResolvedValue([liveCommentRow()]);
    await service.fetchUnprompted('live-1');
    expect(prisma.liveComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { liveSessionId: 'live-1', status: 'collected' },
        orderBy: { postedAt: 'asc' },
        take: 50,
      }),
    );
  });

  it('markPrompted — collected→prompted CAS(+promptedAt)', async () => {
    const { prisma, service } = setup();
    await service.markPrompted(['lc-1', 'lc-2']);
    expect(prisma.liveComment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['lc-1', 'lc-2'] }, status: 'collected' },
        data: expect.objectContaining({ status: 'prompted' }),
      }),
    );
  });

  it('recentForPrompter — collected/prompted, 오름차순 반환(reverse)', async () => {
    const { prisma, service } = setup();
    prisma.liveComment.findMany.mockResolvedValue([
      liveCommentRow({ id: 'b' }),
      liveCommentRow({ id: 'a' }),
    ]);
    const rows = await service.recentForPrompter('live-1');
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']); // desc 조회 후 reverse
  });
});
