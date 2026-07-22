import { Injectable } from '@nestjs/common';
import type { AnalyzeResponse } from '@gachinol/shared';
import type { AiAnalysis as AiAnalysisRow } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { newId } from '../common/ids';
import { PrismaService } from '../prisma/prisma.service';

/** JSON 서브객체 → Prisma Json 입력 (null이면 JsonNull, readonly 배열은 InputJsonValue로 캐스팅) */
const toJson = (v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  v == null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);

/**
 * ai_analyses의 유일 DB 기록자 — 멱등 upsert on (contentId, generation).
 * QueueEvents 다중 수신·리컨사일 재적용에도 (content_id, generation) unique가 하드 가드 → 1행 유지.
 * 재수신 시 산출 메타만 갱신하고 생성 계보(id·createdAt·createdByJobId)는 보존한다.
 */
@Injectable()
export class AiAnalysesService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    contentId: string,
    generation: number,
    jobId: string,
    res: AnalyzeResponse,
  ): Promise<AiAnalysisRow> {
    const now = new Date();
    return this.prisma.aiAnalysis.upsert({
      where: { contentId_generation: { contentId, generation } },
      create: {
        id: newId(),
        contentId,
        generation,
        vision: toJson(res.vision),
        text: toJson(res.text),
        recommendationScore: res.recommendationScore ?? null,
        modelInfo: toJson(res.modelInfo),
        createdByJobId: jobId,
        completedAt: now,
      },
      // 재수신: 산출 메타 갱신, 생성 계보(id·createdAt·createdByJobId) 보존
      update: {
        vision: toJson(res.vision),
        text: toJson(res.text),
        recommendationScore: res.recommendationScore ?? null,
        modelInfo: toJson(res.modelInfo),
        completedAt: now,
      },
    });
  }

  /** 상세 DTO용 — 현 세대 분석 단건 */
  findCurrent(contentId: string, generation: number): Promise<AiAnalysisRow | null> {
    return this.prisma.aiAnalysis.findUnique({
      where: { contentId_generation: { contentId, generation } },
    });
  }
}
