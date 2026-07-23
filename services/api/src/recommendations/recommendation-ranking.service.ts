import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ContentId, RecommendationItem } from '@gachinol/shared';
import { toId } from '@gachinol/shared';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { buildReason, buildWeeklySummary } from './reason';
import { weekWindowUtc } from './week';

/** 랭킹 입력 1건 — DB 무의존 순수 구조체(단위 테스트의 표적) */
export interface RankCandidate {
  contentId: string;
  category: string;
  publishedAt: Date;
  /** ai_analyses.recommendation_score (없으면 null → 0으로 정규화) */
  score: number | null;
  summary?: string;
  keywords?: readonly string[];
}

export interface RankParams {
  /** 정규화된 월요일 'YYYY-MM-DD' */
  weekOf: string;
  /** 배선만 완료 — v1은 항상 [] (recommendation-job.ts 주석 참고) */
  excludeContentIds?: readonly string[];
  /** 미지정 시 RECOMMENDATION_TOP_N */
  topN?: number;
  /** 총평 접두용(재생성일 때만) */
  generation?: number;
  revisionNote?: string;
}

export interface RankResult {
  /** 절단 전 후보 수 */
  candidateCount: number;
  items: readonly RecommendationItem[];
  summary: string;
}

/**
 * 전순서 정렬 — score DESC(null→0) → publishedAt DESC → contentId ASC.
 * 3단이라 동점에도 결과가 절대 흔들리지 않는다(결정성 = 재생성 신뢰의 근거).
 */
export const sortCandidates = (candidates: readonly RankCandidate[]): RankCandidate[] =>
  [...candidates].sort((a, b) => {
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    if (sa !== sb) return sb - sa;
    const ta = a.publishedAt.getTime();
    const tb = b.publishedAt.getTime();
    if (ta !== tb) return tb - ta;
    return a.contentId < b.contentId ? -1 : a.contentId > b.contentId ? 1 : 0;
  });

/** 순수 랭킹 — 정렬 → 상위 N 절단 → rank 1부터 재부여 + reason 파생 */
export const rankCandidates = (
  candidates: readonly RankCandidate[],
  topN: number,
): RecommendationItem[] =>
  sortCandidates(candidates)
    .slice(0, Math.max(0, topN))
    .map((c, i) => {
      const rank = i + 1;
      const item: RecommendationItem = {
        contentId: toId<ContentId>(c.contentId),
        rank,
        reason: buildReason({
          summary: c.summary,
          keywords: c.keywords,
          score: c.score ?? 0,
          rank,
        }),
      };
      // score는 optional — 분석에 점수가 없으면 생략(0을 날조하지 않는다)
      return c.score == null ? item : { ...item, score: c.score };
    });

/** 선정 항목의 분류 분포 (총평용) */
export const categoryCounts = (
  items: readonly RecommendationItem[],
  byId: ReadonlyMap<string, RankCandidate>,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) {
    const category = byId.get(item.contentId)?.category;
    if (category) out[category] = (out[category] ?? 0) + 1;
  }
  return out;
};

/**
 * 주간 추천 랭킹 — **read-only**. 행 기록·전이는 절대 하지 않는다(api 유일 기록자 규약).
 * ai-worker 재호출 없음: 기존 ai_analyses.recommendation_score를 재사용한다(실 ML 재랭킹은 후속).
 *
 * 후보 조건: contents.status='published' ∧ published_at ∈ 주차 윈도우 ∧
 *            같은 세대(ai_analyses.generation = contents.generation) 완료 분석 존재 ∧ 제외목록 밖.
 * 지사(kind) 필터는 없다 — 운영 정책이지 계산 규칙이 아니다(열린 질문, 필요 시 where 1줄).
 */
@Injectable()
export class RecommendationRankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get defaultTopN(): number {
    return this.config.get('RECOMMENDATION_TOP_N', { infer: true });
  }

  async rank(params: RankParams): Promise<RankResult> {
    const topN = params.topN ?? this.defaultTopN;
    const candidates = await this.loadCandidates(params.weekOf, params.excludeContentIds ?? []);
    const items = rankCandidates(candidates, topN);
    const byId = new Map(candidates.map((c) => [c.contentId, c]));
    return {
      candidateCount: candidates.length,
      items,
      summary: buildWeeklySummary({
        weekOf: params.weekOf,
        candidateCount: candidates.length,
        selectedCount: items.length,
        categoryCounts: categoryCounts(items, byId),
        generation: params.generation ?? 1,
        revisionNote: params.revisionNote,
      }),
    };
  }

  /** 후보 수집 — contents ⨝ ai_analyses(같은 세대·완료). 세대 대조는 JS(Prisma 컬럼간 비교 미지원) */
  private async loadCandidates(
    weekOf: string,
    excludeContentIds: readonly string[],
  ): Promise<RankCandidate[]> {
    const { start, end } = weekWindowUtc(weekOf);
    const contents = await this.prisma.content.findMany({
      where: {
        status: 'published',
        publishedAt: { gte: start, lt: end },
        ...(excludeContentIds.length ? { id: { notIn: [...excludeContentIds] } } : {}),
      },
      select: { id: true, generation: true, category: true, publishedAt: true },
    });
    if (contents.length === 0) return [];

    const analyses = await this.prisma.aiAnalysis.findMany({
      where: { contentId: { in: contents.map((c) => c.id) }, completedAt: { not: null } },
      select: { contentId: true, generation: true, recommendationScore: true, text: true },
    });
    const analysisByContent = new Map(analyses.map((a) => [`${a.contentId}:${a.generation}`, a]));

    const out: RankCandidate[] = [];
    for (const c of contents) {
      const analysis = analysisByContent.get(`${c.id}:${c.generation}`);
      if (!analysis || !c.publishedAt) continue; // 분석 없음 = 후보 아님(주간뉴스 소재 판단 불가)
      const text = analysis.text as { summary?: string; keywords?: string[] } | null;
      out.push({
        contentId: c.id,
        category: c.category,
        publishedAt: c.publishedAt,
        score: analysis.recommendationScore ?? null,
        summary: typeof text?.summary === 'string' ? text.summary : undefined,
        keywords: Array.isArray(text?.keywords) ? text.keywords : undefined,
      });
    }
    return out;
  }
}
