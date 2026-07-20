import { adminUser, makePrismaMock, stationRow } from '../test-support/fixtures';
import { StationWorkflowService } from './station-workflow.service';

describe('StationWorkflowService', () => {
  const setup = (row: ReturnType<typeof stationRow>) => {
    const prisma = makePrismaMock();
    prisma.station.findUnique.mockResolvedValue(row);
    prisma.station.findUniqueOrThrow.mockResolvedValue(row);
    return { prisma, service: new StationWorkflowService(prisma) };
  };

  it('dormant→operating(부활) 허용 — dormantSince 해제 + station 로그', async () => {
    const row = stationRow({ status: 'dormant' });
    const { prisma, service } = setup(row);

    await service.transition(row.id, 'operating', adminUser(), '애월 부활');

    const update = prisma.station.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: row.id, status: 'dormant' });
    expect(update.data).toMatchObject({ status: 'operating', dormantSince: null });
    const log = prisma.statusTransitionLog.create.mock.calls[0][0].data;
    expect(log).toMatchObject({
      entityType: 'station',
      fromStatus: 'dormant',
      toStatus: 'operating',
      actorUserId: 'u-admin',
      note: '애월 부활',
    });
  });

  it('operating→dormant 시 dormantSince 세팅', async () => {
    const row = stationRow({ status: 'operating', dormantSince: null });
    const { prisma, service } = setup(row);
    await service.transition(row.id, 'dormant', adminUser());
    expect(prisma.station.updateMany.mock.calls[0][0].data.dormantSince).toBeInstanceOf(Date);
  });

  it('operating→planned 거부 (invalid_transition + allowed)', async () => {
    const { service } = setup(stationRow({ status: 'operating' }));
    await expect(service.transition('s-aewol', 'planned', adminUser())).rejects.toMatchObject({
      code: 'invalid_transition',
      details: { from: 'operating', to: 'planned', allowed: ['dormant'] },
    });
  });

  it('CAS affected=0 → conflict', async () => {
    const { prisma, service } = setup(stationRow({ status: 'dormant' }));
    prisma.station.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.transition('s-aewol', 'operating', adminUser())).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});
