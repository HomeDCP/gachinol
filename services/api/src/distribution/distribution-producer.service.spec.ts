import { channelAccountRow, contentRow, publicationRow } from '../test-support/fixtures';
import { DistributionProducerService } from './distribution-producer.service';
import { publishJobId } from './distribution-job';

const setup = (opts: { queue?: unknown } = {}) => {
  const queue =
    opts.queue === undefined
      ? {
          add: jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        }
      : opts.queue;
  const channels = {
    findByIds: jest.fn().mockResolvedValue(new Map([['ch-aewol', channelAccountRow()]])),
  };
  const publications = {
    requeueFailedForContent: jest.fn().mockResolvedValue([publicationRow({ status: 'queued' })]),
  };
  const assets = { listForContent: jest.fn().mockResolvedValue([]) };
  const s3 = { presignGet: jest.fn().mockResolvedValue({ url: 'https://signed' }) };
  const config = {
    get: jest.fn((key: string) => {
      const map: Record<string, unknown> = {
        PUBLISH_JOB_ATTEMPTS: 3,
        PUBLISH_JOB_BACKOFF_MS: 5000,
      };
      return map[key];
    }),
  };
  const service = new DistributionProducerService(
    queue as never,
    channels as never,
    publications as never,
    assets as never,
    s3 as never,
    config as never,
  );
  return { queue, channels, publications, assets, s3, service };
};

describe('DistributionProducerService', () => {
  it('enabled: queue null → false', () => {
    expect(setup({ queue: null }).service.enabled).toBe(false);
  });

  it('enabled: queue 존재 → true', () => {
    expect(setup().service.enabled).toBe(true);
  });

  it('enqueuePublish: 결정적 jobId(대상 집합 반영)·PublishTargetItem 패킹·priority normal=5·attempts/backoff/removeOnComplete', async () => {
    const { queue, service } = setup();
    await service.enqueuePublish(contentRow(), [publicationRow()]);

    // jobId는 실제 인큐되는 pubId 집합으로 결정 — remove/add가 동일 jobId 공유(재큐 멱등)
    const expectedJobId = publishJobId('c-1', 1, ['pub-1']);
    expect(expectedJobId).toMatch(/^publish:c-1:g1-[0-9a-f]{12}$/);
    expect((queue as any).remove).toHaveBeenCalledWith(expectedJobId);
    const [name, data, opts] = (queue as any).add.mock.calls[0];
    expect(name).toBe('publish');
    expect(opts.jobId).toBe(expectedJobId);
    expect(opts.priority).toBe(5);
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
    expect(opts.removeOnComplete).toEqual({ age: 3600, count: 200 });
    expect(opts.removeOnFail).toBe(false);
    // 좌표 패킹
    expect(data.publications).toHaveLength(1);
    const t = data.publications[0];
    expect(t).toMatchObject({
      publicationId: 'pub-1',
      platform: 'kakao',
      externalChannelId: 'kakao-aewol',
      credentialRef: 'kakao:aewol',
      idempotencyKey: 'pub-1',
    });
    expect(t.message.title).toBe('애월 해녀 인터뷰');
  });

  it('enqueuePublish: 채널 B·C 단일 retry는 서로 다른 jobId(동시 재시도 clobber 방지)', async () => {
    // 채널 B·C 각각의 단일 채널 재시도 — 같은 content/generation이라도 대상 집합이 다르면 jobId가 달라야 한다.
    const chB = channelAccountRow({ id: 'ch-b' });
    const chC = channelAccountRow({ id: 'ch-c' });
    const channels = {
      findByIds: jest.fn().mockResolvedValue(
        new Map([
          ['ch-b', chB],
          ['ch-c', chC],
        ]),
      ),
    };
    const queue = {
      add: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const assets = { listForContent: jest.fn().mockResolvedValue([]) };
    const s3 = { presignGet: jest.fn().mockResolvedValue({ url: 'https://signed' }) };
    const config = { get: jest.fn(() => 3) };
    const service = new DistributionProducerService(
      queue as never,
      channels as never,
      {} as never,
      assets as never,
      s3 as never,
      config as never,
    );

    await service.enqueuePublish(contentRow(), [
      publicationRow({ id: 'pub-b', channelAccountId: 'ch-b' }),
    ]);
    await service.enqueuePublish(contentRow(), [
      publicationRow({ id: 'pub-c', channelAccountId: 'ch-c' }),
    ]);

    const jobIdB = queue.add.mock.calls[0][2].jobId;
    const jobIdC = queue.add.mock.calls[1][2].jobId;
    expect(jobIdB).not.toBe(jobIdC);
    // remove도 각자의 jobId만 지운다(상대 잡 clobber 없음)
    expect(queue.remove.mock.calls[0][0]).toBe(jobIdB);
    expect(queue.remove.mock.calls[1][0]).toBe(jobIdC);
  });

  it('enqueuePublish: 720p 렌디션·썸네일 서명 URL을 message에 실음(best-effort)', async () => {
    const { assets, service, queue } = setup();
    assets.listForContent.mockResolvedValue([
      { kind: 'rendition', renditionLabel: '720p', status: 'ready', storageKey: 'r.mp4' },
      { kind: 'thumbnail', status: 'ready', storageKey: 't.jpg' },
    ]);
    await service.enqueuePublish(contentRow(), [publicationRow()]);
    const t = (queue as any).add.mock.calls[0][1].publications[0];
    expect(t.message.playbackUrl).toBe('https://signed');
    expect(t.message.thumbnailUrl).toBe('https://signed');
  });

  it('enqueuePublish: urgent → priority=1', async () => {
    const { queue, service } = setup();
    await service.enqueuePublish(contentRow({ priority: 'urgent' }), [publicationRow()]);
    expect((queue as any).add.mock.calls[0][2].priority).toBe(1);
  });

  it('enqueuePublish: queue null → no-op', async () => {
    const { channels, service } = setup({ queue: null });
    await service.enqueuePublish(contentRow(), [publicationRow()]);
    expect(channels.findByIds).not.toHaveBeenCalled();
  });

  it('enqueuePublish: publications 빈 배열 → no-op', async () => {
    const { queue, service } = setup();
    await service.enqueuePublish(contentRow(), []);
    expect((queue as any).add).not.toHaveBeenCalled();
  });

  it('requeueForStatus: publishing이면 failed 재큐, 그 외 no-op', async () => {
    const { publications, queue, service } = setup();
    await service.requeueForStatus(contentRow({ status: 'publishing' }));
    expect(publications.requeueFailedForContent).toHaveBeenCalledWith('c-1');
    expect((queue as any).add).toHaveBeenCalledTimes(1);

    await service.requeueForStatus(contentRow({ status: 'preview_generating' }));
    expect((queue as any).add).toHaveBeenCalledTimes(1); // 증가 없음
  });
});
