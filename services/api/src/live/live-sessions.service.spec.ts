import type { ConfigService } from '@nestjs/config';
import { DomainException } from '../common/errors/domain.exception';
import type { Env } from '../config/env.schema';
import { adminUser, centerOperatorUser, liveSessionRow, makePrismaMock, stationRow } from '../test-support/fixtures';
import type { LiveBroadcaster } from './live.broadcaster';
import { LiveSessionsService } from './live-sessions.service';
import type { CreateLiveSessionDto } from './schemas/live.schemas';

const envDefaults: Record<string, unknown> = {
  LIVE_DEV_STREAM_KEY: undefined,
  LIVE_RTMP_INGEST_URL: undefined,
  LIVE_HLS_PLAYBACK_URL: undefined,
};
const configMock = { get: (k: string) => envDefaults[k] } as unknown as ConfigService<Env, true>;

const setup = () => {
  const prisma = makePrismaMock();
  const broadcaster = { emitLiveStatus: jest.fn() } as unknown as LiveBroadcaster;
  const service = new LiveSessionsService(prisma, configMock, broadcaster);
  return { prisma, broadcaster, service };
};

const dto = (over: Partial<CreateLiveSessionDto> = {}): CreateLiveSessionDto =>
  ({ type: 'news', title: 'T', scheduledAt: '2026-07-25T10:00:00.000Z', targetChannelAccountIds: [], ...over }) as CreateLiveSessionDto;

describe('LiveSessionsService', () => {
  describe('create — 불변식 type=emergency ⇔ scheduledAt=null', () => {
    it('emergency + scheduledAt 지정 → validation_failed', async () => {
      const { service } = setup();
      await expect(service.create(dto({ type: 'emergency', scheduledAt: '2026-07-25T10:00:00.000Z' }), adminUser())).rejects.toMatchObject({ code: 'validation_failed' });
    });

    it('비긴급 + scheduledAt=null → validation_failed', async () => {
      const { service } = setup();
      await expect(service.create(dto({ type: 'news', scheduledAt: null }), adminUser())).rejects.toMatchObject({ code: 'validation_failed' });
    });

    it('emergency → preparing 직접 생성(hostStationId 생략 시 센터)', async () => {
      const { prisma, service } = setup();
      prisma.station.findUnique.mockResolvedValue(stationRow({ id: 's-center', code: 'center' }));
      prisma.liveSession.create.mockImplementation(async ({ data }: any) => data);
      const row = await service.create(dto({ type: 'emergency', scheduledAt: null }), adminUser());
      expect(row.status).toBe('preparing');
      expect(row.hostStationId).toBe('s-center');
    });

    it('정규 편성 → scheduled', async () => {
      const { prisma, service } = setup();
      prisma.station.findUnique.mockResolvedValue(stationRow({ id: 's-center', code: 'center' }));
      prisma.liveSession.create.mockImplementation(async ({ data }: any) => data);
      const row = await service.create(dto({ type: 'news' }), adminUser());
      expect(row.status).toBe('scheduled');
    });
  });

  describe('라이프사이클 전이(CAS + 로그 + 브로드캐스트)', () => {
    it('prepare: scheduled→preparing + rtmpIngestUrl·streamKeyRef 발급', async () => {
      const { prisma, broadcaster, service } = setup();
      prisma.liveSession.findUnique
        .mockResolvedValueOnce(liveSessionRow({ status: 'scheduled' }))
        .mockResolvedValueOnce(liveSessionRow({ status: 'preparing', streamKeyRef: 'live:live-1' }));
      prisma.liveSession.updateMany.mockResolvedValue({ count: 1 });
      const row = await service.prepare('live-1', centerOperatorUser());
      expect(prisma.liveSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'live-1', status: 'scheduled' },
          data: expect.objectContaining({ status: 'preparing', streamKeyRef: 'live:live-1' }),
        }),
      );
      expect(prisma.statusTransitionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ entityType: 'live_session', fromStatus: 'scheduled', toStatus: 'preparing' }) }),
      );
      expect(broadcaster.emitLiveStatus).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'scheduled', to: 'preparing' }),
      );
      expect(row.status).toBe('preparing');
    });

    it('불법 전이(scheduled→ended) → invalid_transition (shared 전이맵)', async () => {
      const { prisma, service } = setup();
      prisma.liveSession.findUnique.mockResolvedValue(liveSessionRow({ status: 'scheduled' }));
      await expect(service.end('live-1', centerOperatorUser())).rejects.toMatchObject({ code: 'invalid_transition' });
    });

    it('CAS 경합(count=0) → conflict', async () => {
      const { prisma, service } = setup();
      prisma.liveSession.findUnique.mockResolvedValue(liveSessionRow({ status: 'preparing' }));
      prisma.liveSession.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.start('live-1', centerOperatorUser())).rejects.toMatchObject({ code: 'conflict' });
    });

    it('end: interrupted→ended 허용(shared 전이맵)', async () => {
      const { prisma, service } = setup();
      prisma.liveSession.findUnique
        .mockResolvedValueOnce(liveSessionRow({ status: 'interrupted' }))
        .mockResolvedValueOnce(liveSessionRow({ status: 'ended' }));
      prisma.liveSession.updateMany.mockResolvedValue({ count: 1 });
      const row = await service.end('live-1', centerOperatorUser());
      expect(row.status).toBe('ended');
    });
  });

  describe('공개 조회', () => {
    it('listPublic — 공개 상태 집합만 조회', async () => {
      const { prisma, service } = setup();
      prisma.liveSession.findMany.mockResolvedValue([]);
      await service.listPublic();
      expect(prisma.liveSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ['scheduled', 'preparing', 'live', 'interrupted'] } },
        }),
      );
    });

    it('getPublicOr404 — ended는 404', async () => {
      const { prisma, service } = setup();
      prisma.liveSession.findUnique.mockResolvedValue(liveSessionRow({ status: 'ended' }));
      await expect(service.getPublicOr404('live-1')).rejects.toMatchObject({ code: 'not_found' });
    });

    it('isJoinable', () => {
      expect(LiveSessionsService.isJoinable('live')).toBe(true);
      expect(LiveSessionsService.isJoinable('interrupted')).toBe(true);
      expect(LiveSessionsService.isJoinable('ended')).toBe(false);
      expect(LiveSessionsService.isJoinable('canceled')).toBe(false);
    });
  });

  describe('getIngest — streamKey dev 플레이스홀더', () => {
    it('LIVE_DEV_STREAM_KEY 미설정 → dev-{id}', async () => {
      const { prisma, service } = setup();
      prisma.liveSession.findUnique.mockResolvedValue(liveSessionRow({ status: 'preparing', rtmpIngestUrl: 'rtmp://x/live-1' }));
      const info = await service.getIngest('live-1');
      expect(info.streamKey).toBe('dev-live-1');
      expect(info.rtmpUrl).toBe('rtmp://x/live-1');
    });
  });

  it('DomainException 인스턴스로 던진다(계약 정합)', async () => {
    const { prisma, service } = setup();
    prisma.liveSession.findUnique.mockResolvedValue(null);
    await expect(service.loadOr404('missing')).rejects.toBeInstanceOf(DomainException);
  });
});
