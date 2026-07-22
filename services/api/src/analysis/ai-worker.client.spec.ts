import type { AnalyzeRequest } from '@gachinol/shared';
import { AiWorkerClient } from './ai-worker.client';

const config = (over: Record<string, unknown> = {}) => ({
  get: jest.fn((key: string) => {
    const map: Record<string, unknown> = {
      AI_WORKER_URL: 'http://ai-worker.test:8000',
      AI_WORKER_TIMEOUT_MS: 120000,
      ...over,
    };
    return map[key];
  }),
});

const req: AnalyzeRequest = { contentId: 'c-1', generation: 1, languageHint: 'ko' };

describe('AiWorkerClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('POST {url}/analyze — JSON body·content-type', async () => {
    const resp = { vision: { shots: [], labels: [] } };
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => resp });
    global.fetch = fetchMock as never;

    const client = new AiWorkerClient(config() as never);
    const out = await client.analyze(req);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ai-worker.test:8000/analyze');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(req);
    expect(out).toEqual(resp);
  });

  it('trailing slash 정규화 — 이중 슬래시 방지', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock as never;
    const client = new AiWorkerClient(config({ AI_WORKER_URL: 'http://ai-worker.test:8000/' }) as never);
    await client.analyze(req);
    expect(fetchMock.mock.calls[0][0]).toBe('http://ai-worker.test:8000/analyze');
  });

  it('non-2xx → throw (BullMQ 재시도 유도)', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    global.fetch = fetchMock as never;
    const client = new AiWorkerClient(config() as never);
    await expect(client.analyze(req)).rejects.toThrow(/500/);
  });

  it('AI_WORKER_URL 미설정 → throw', async () => {
    const client = new AiWorkerClient(config({ AI_WORKER_URL: undefined }) as never);
    await expect(client.analyze(req)).rejects.toThrow(/AI_WORKER_URL/);
  });
});
