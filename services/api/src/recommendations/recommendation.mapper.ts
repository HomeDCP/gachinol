import type {
  JobId,
  RecommendationStatus,
  UserId,
  WeeklyRecommendation,
  WeeklyRecommendationId,
} from '@gachinol/shared';
import { toId } from '@gachinol/shared';
import type { WeeklyRecommendation as RecommendationRow } from '@prisma/client';
import { zRecommendationItems } from './schemas/recommendation.schemas';
import { toDateOnly } from './week';

/**
 * row → shared WeeklyRecommendation. items는 읽기 경계에서도 zod 재검증(rank 연속·중복 금지) —
 * 항목 ≤ topN(기본 7)이라 비용 무시 가능, 정합 우선(contents.scenes 선례).
 * ★ week_of(Prisma `@db.Date`)는 반드시 UTC 기반 toDateOnly로 — 로컬 오프셋 포맷은 하루 밀린다.
 */
export const toWeeklyRecommendation = (row: RecommendationRow): WeeklyRecommendation => ({
  id: toId<WeeklyRecommendationId>(row.id),
  weekOf: toDateOnly(row.weekOf),
  status: row.status as RecommendationStatus,
  generation: row.generation,
  summary: row.summary ?? undefined,
  items: zRecommendationItems.parse(row.items),
  generatedByJobId: row.generatedByJobId ? toId<JobId>(row.generatedByJobId) : null,
  approvedByUserId: row.approvedByUserId ? toId<UserId>(row.approvedByUserId) : null,
  approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
  publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
