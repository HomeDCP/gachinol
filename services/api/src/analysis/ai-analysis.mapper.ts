import type {
  AiAnalysis,
  AiAnalysisId,
  ContentId,
  TextAnalysis,
  VisionAnalysis,
} from '@gachinol/shared';
import { toId } from '@gachinol/shared';
import type { AiAnalysis as AiAnalysisRow } from '@prisma/client';

/**
 * row → shared AiAnalysis. vision/text/modelInfo는 JSONB를 그대로 캐스팅(ai-worker가 camelCase로 저장).
 * recommendationScore/completedAt은 null → undefined, 시각은 ISO 문자열.
 */
export const toAiAnalysis = (row: AiAnalysisRow): AiAnalysis => ({
  id: toId<AiAnalysisId>(row.id),
  contentId: toId<ContentId>(row.contentId),
  generation: row.generation,
  vision: (row.vision as unknown as VisionAnalysis | null) ?? undefined,
  text: (row.text as unknown as TextAnalysis | null) ?? undefined,
  recommendationScore: row.recommendationScore ?? undefined,
  modelInfo: (row.modelInfo as unknown as AiAnalysis['modelInfo'] | null) ?? undefined,
  createdAt: row.createdAt.toISOString(),
  completedAt: row.completedAt ? row.completedAt.toISOString() : undefined,
});
