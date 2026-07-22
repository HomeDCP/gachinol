import type { AnalyzeResponse } from '@gachinol/shared';
import { Prisma } from '@prisma/client';
import { AiAnalysesService } from './ai-analyses.service';

const setup = () => {
  const prisma = {
    aiAnalysis: {
      upsert: jest.fn().mockImplementation(async (args: any) => ({ id: 'a-1', ...args.create })),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  return { prisma, service: new AiAnalysesService(prisma as never) };
};

const fullResp: AnalyzeResponse = {
  vision: { shots: [{ startSec: 0, endSec: 5 }], labels: ['바다'] },
  text: { transcript: [], summary: 's', keywords: ['k'], tags: ['t'] },
  recommendationScore: 0.5,
  modelInfo: { version: '0.1.0' },
};

describe('AiAnalysesService', () => {
  it('upsert: (contentId, generation) where + create/update 산출메타', async () => {
    const { prisma, service } = setup();
    await service.upsert('c-1', 1, 'analysis:c-1:g1', fullResp);
    const args = prisma.aiAnalysis.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ contentId_generation: { contentId: 'c-1', generation: 1 } });
    expect(args.create.createdByJobId).toBe('analysis:c-1:g1');
    expect(args.create.vision).toEqual(fullResp.vision);
    expect(args.create.recommendationScore).toBe(0.5);
    // update는 생성 계보(id·createdByJobId·createdAt) 미포함
    expect(args.update.createdByJobId).toBeUndefined();
    expect(args.update.vision).toEqual(fullResp.vision);
  });

  it('부분 분석(vision-only): text 없으면 JsonNull 저장', async () => {
    const { prisma, service } = setup();
    await service.upsert('c-1', 1, 'j', { vision: fullResp.vision });
    const args = prisma.aiAnalysis.upsert.mock.calls[0][0];
    expect(args.create.vision).toEqual(fullResp.vision);
    expect(args.create.text).toBe(Prisma.JsonNull);
    expect(args.create.recommendationScore).toBeNull();
  });

  it('findCurrent: findUnique on (contentId, generation)', async () => {
    const { prisma, service } = setup();
    await service.findCurrent('c-1', 2);
    expect(prisma.aiAnalysis.findUnique).toHaveBeenCalledWith({
      where: { contentId_generation: { contentId: 'c-1', generation: 2 } },
    });
  });
});
