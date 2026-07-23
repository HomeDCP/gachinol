import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Paginated,
  RecommendationItem,
  RecommendationReview,
  RecommendationStatus,
  RevisionRequestId,
  User,
  WeeklyRecommendation,
} from '@gachinol/shared';
import { Prisma } from '@prisma/client';
import type { WeeklyRecommendation as RecommendationRow } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { newId } from '../common/ids';
import type { Env } from '../config/env.schema';
import { toPaginated, toSkipTake } from '../common/pagination/pagination.util';
import { toContentSummary } from '../contents/content.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { toWeeklyRecommendation } from './recommendation.mapper';
import {
  recommendationJobId,
  type RecommendationJobData,
  type RecommendationJobResult,
} from './recommendation-job';
import { RecommendationProducerService } from './recommendation-producer.service';
import { RecommendationWorkflowService } from './recommendation-workflow.service';
import {
  zRecommendationItems,
  type GenerateRecommendationDto,
  type RecommendationListQueryDto,
  type RequestRecommendationRevisionDto,
} from './schemas/recommendation.schemas';
import { mondayOfWeekKst, parseDateOnly, toDateOnly } from './week';

/** 진행 중 — 같은 주차 재요청은 409(생성 트리거 중복 방지) */
const IN_PROGRESS: readonly RecommendationStatus[] = ['generating', 'regenerating'];

/**
 * weekly_recommendations의 유일 DB 기록자.
 * 상태 변경은 전부 RecommendationWorkflowService(shared 전이맵 검증 + CAS + 감사)를 경유한다.
 * 계산은 RecommendationRankingService 하나, 트랜스포트만 큐/인라인으로 갈린다.
 */
@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: RecommendationWorkflowService,
    private readonly producer: RecommendationProducerService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * POST /v1/recommendations — 주차 추천 생성 트리거.
   * weekOf는 서버가 그 주 월요일(KST)로 정규화 → week_of unique가 멱등 키.
   * 상태별 분기: 없음→생성 · generation_failed→재시도 · 진행중(고착 아님)/기존→409 ·
   * 진행중이지만 고착(RECOMMENDATION_STUCK_MS 초과)→강제 실패 후 같은 요청에서 재시도.
   */
  async generate(user: User, dto: GenerateRecommendationDto): Promise<WeeklyRecommendation> {
    this.workflow.requireCenterActor(user);
    const weekOf = mondayOfWeekKst(dto.weekOf);
    const weekOfDate = parseDateOnly(weekOf);

    const existing = await this.prisma.weeklyRecommendation.findUnique({
      where: { weekOf: weekOfDate },
    });

    let row: RecommendationRow;
    /** 재시도 경로에서 아직 반영되지 않은 수정요청 — 지시·해소 링크를 잃지 않도록 재패킹 */
    let revision: { id: string; message: string } | null = null;
    if (!existing) {
      row = await this.createGenerating(weekOfDate);
    } else {
      const status = existing.status as RecommendationStatus;
      if (status === 'generation_failed') {
        await this.prisma.$transaction((tx) => this.workflow.retryGeneration(tx, existing, user));
        row = await this.workflow.load(existing.id);
        revision = await this.pendingRevision(existing.id);
      } else if (IN_PROGRESS.includes(status)) {
        row = await this.recoverStuck(existing, status, user);
        revision = await this.pendingRevision(existing.id);
      } else {
        throw new DomainException('conflict', '해당 주차 추천이 이미 있습니다', {
          id: existing.id,
          status,
        });
      }
    }

    // 인큐-애프터-커밋 (폴백 경로는 즉시 계산 + 기록)
    await this.dispatch({
      recommendationId: row.id,
      weekOf,
      generation: row.generation,
      revisionRequestId: revision?.id ?? null,
      revisionNote: revision?.message ?? null,
      excludeContentIds: [],
    });
    return toWeeklyRecommendation(await this.workflow.load(row.id));
  }

  /** GET /v1/recommendations — weekOf DESC */
  async list(query: RecommendationListQueryDto): Promise<Paginated<WeeklyRecommendation>> {
    const where: Prisma.WeeklyRecommendationWhereInput = query.status
      ? { status: query.status }
      : {};
    const [totalCount, rows] = await this.prisma.$transaction([
      this.prisma.weeklyRecommendation.count({ where }),
      this.prisma.weeklyRecommendation.findMany({
        where,
        orderBy: { weekOf: 'desc' },
        ...toSkipTake(query),
      }),
    ]);
    return toPaginated(rows.map(toWeeklyRecommendation), totalCount, query);
  }

  /**
   * GET /v1/recommendations/:id — items를 rank순으로 ContentSummary 조인.
   * ★ recommendation.items는 원본 전량, 응답 items[]는 조인 성공분만 —
   *   삭제된 콘텐츠는 조용히 빠진다(의도된 설계: 검토 화면이 유령 항목으로 깨지지 않게).
   *   센터가 "항목 수 불일치"를 감지할 수 있도록 원본 배열은 그대로 노출한다.
   */
  async getReview(id: string): Promise<RecommendationReview> {
    const row = await this.workflow.load(id);
    const items = [...zRecommendationItems.parse(row.items)].sort((a, b) => a.rank - b.rank);
    const contentRows = items.length
      ? await this.prisma.content.findMany({
          where: { id: { in: items.map((i) => i.contentId as unknown as string) } },
          include: { station: { select: { name: true } }, reporter: { select: { name: true } } },
        })
      : [];
    const byId = new Map(contentRows.map((c) => [c.id, c]));

    const joined: { item: RecommendationItem; content: ReturnType<typeof toContentSummary> }[] = [];
    for (const item of items) {
      const content = byId.get(item.contentId as unknown as string);
      if (!content) continue; // 콘텐츠 삭제분 — 조용히 제외(원본 items는 불변)
      joined.push({ item, content: toContentSummary(content) });
    }
    return { recommendation: toWeeklyRecommendation(row), items: joined };
  }

  /** POST /v1/recommendations/:id/approve — pending_review → approved. 송출 연쇄 없음(후속) */
  async approve(id: string, user: User): Promise<WeeklyRecommendation> {
    const row = await this.workflow.load(id);
    await this.prisma.$transaction((tx) => this.workflow.approve(tx, row, user));
    return toWeeklyRecommendation(await this.workflow.load(id));
  }

  /**
   * POST /v1/recommendations/:id/request-revision — 2홉:
   * pending_review→revision_requested(user, RevisionRequest 생성 동일 tx) → regenerating(system, gen+1).
   * 커밋 후 재생성 인큐(인큐-애프터-커밋).
   */
  async requestRevision(
    id: string,
    user: User,
    dto: RequestRecommendationRevisionDto,
  ): Promise<WeeklyRecommendation> {
    const row = await this.workflow.load(id);
    this.workflow.requireCenterActor(user);
    const revisionRequestId: string = newId<RevisionRequestId>();

    await this.prisma.$transaction(async (tx) => {
      await this.workflow.requestRevision(tx, row, user, dto.note);
      await tx.revisionRequest.create({
        data: {
          id: revisionRequestId,
          targetKind: 'recommendation',
          contentId: null,
          recommendationId: row.id,
          requestedByUserId: user.id,
          // requesterRole은 인증 role 매핑 — 센터 전용 엔드포인트라 항상 center_operator
          requesterRole: 'center_operator',
          message: dto.note,
        },
      });
      // 자동 연쇄 — revision_requested의 유일한 전진 경로(중간 상태 미노출, 로그 2건)
      await this.workflow.beginRegeneration(tx, row, dto.note);
    });

    const regenerating = await this.workflow.load(id);
    await this.dispatch({
      recommendationId: regenerating.id,
      weekOf: toDateOnly(regenerating.weekOf),
      generation: regenerating.generation,
      revisionRequestId,
      revisionNote: dto.note,
      excludeContentIds: [],
    });
    return toWeeklyRecommendation(await this.workflow.load(id));
  }

  /**
   * 잡 완료 반영 — 큐 경로(PipelineService)와 인라인 폴백이 공유하는 **유일 기록 진입점**.
   * 순서 규약: items 기록 먼저 → 전이 (관제가 pending_review를 관측할 땐 items가 이미 있다).
   * ★ 세대 CAS: `where {id, generation}` — 늦게 도착한 구세대 결과가 신세대를 덮지 못한다.
   * 후보 0건 판정도 여기서 — 랭킹 서비스는 실패 개념 없이 items:[]만 돌려준다(순수성 유지).
   */
  async applyGenerationResult(
    recommendationId: string,
    expectedGeneration: number,
    jobId: string,
    result: RecommendationJobResult,
  ): Promise<void> {
    const row = await this.prisma.weeklyRecommendation.findUnique({
      where: { id: recommendationId },
    });
    if (!row) return;
    const from = row.status as RecommendationStatus;
    if (from !== 'generating' && from !== 'regenerating') return; // 재수신·추월 → no-op
    if (row.generation !== expectedGeneration) return; // 구세대 결과 → 폐기

    if (result.items.length === 0) {
      // 빈 검토 화면(승인할 게 없는 pending_review)을 만들지 않는다
      await this.workflow.applySystemTransition(recommendationId, from, 'generation_failed', jobId, {
        note: '대상 콘텐츠 0건',
      });
      return;
    }

    // ★ 쓰기 경계 검증 — 읽기(recommendation.mapper)와 **같은 스키마**로 대칭.
    //   계약 밖 items(예: 0~1 범위를 벗어난 recommendationScore)를 그대로 영속시키면
    //   그 주차 행이 목록·상세를 영구 500(생 ZodError)으로 만들고, 고칠 API 진입점이 없다.
    const parsed = zRecommendationItems.safeParse(result.items);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const detail = first ? `${first.path.join('.')}: ${first.message}` : '알 수 없는 위반';
      this.logger.error(`추천 items 계약 위반 (id=${recommendationId}): ${detail}`);
      await this.workflow.applySystemTransition(recommendationId, from, 'generation_failed', jobId, {
        note: `items 계약 위반 — ${detail}`.slice(0, 500),
      });
      return;
    }

    const updated = await this.prisma.weeklyRecommendation.updateMany({
      where: { id: recommendationId, generation: expectedGeneration },
      data: {
        items: parsed.data as unknown as Prisma.InputJsonValue,
        summary: result.summary,
        generatedByJobId: jobId,
      },
    });
    if (updated.count === 0) return; // 세대 경합 — 신세대 결과가 이미 자리를 잡았다

    const hop = await this.workflow.applySystemTransition(
      recommendationId,
      from,
      'pending_review',
      jobId,
    );
    if (hop.applied) {
      // 수정요청 해소 — 미해소분 전체(생성 1회가 그 시점 지시들을 모두 반영한다).
      // ★ from==='regenerating'으로 좁히지 않는다: 재생성이 실패한 뒤의 재시도는 from='generating'
      //   (세대 유지)인데 그 잡도 미해소 지시를 재패킹해 반영하므로 해소돼야 한다.
      //   최초 생성(gen 1)에는 미해소 지시가 존재할 수 없어 where가 아무것도 잡지 않는다.
      await this.prisma.revisionRequest.updateMany({
        where: { recommendationId, resolvedAt: null },
        data: { resolvedAt: new Date(), resolvedByJobId: jobId },
      });
    }
  }

  /** 잡 소진(또는 인라인 예외) — generating·regenerating → generation_failed(note=사유) */
  async failGeneration(recommendationId: string, jobId: string, reason: string): Promise<void> {
    const row = await this.prisma.weeklyRecommendation.findUnique({
      where: { id: recommendationId },
    });
    if (!row) return;
    const from = row.status as RecommendationStatus;
    if (from !== 'generating' && from !== 'regenerating') return;
    await this.workflow.applySystemTransition(recommendationId, from, 'generation_failed', jobId, {
      note: reason.slice(0, 500),
    });
  }

  // ── 내부 ──────────────────────────────────────────────

  /**
   * 진행 중 재요청 — 고착이 아니면 409, 고착이면 강제 실패 후 재시도(같은 요청에서 generating 복귀).
   *
   * ★ 이 진입점이 없으면 잡 유실(Redis flush·재기동)·프로세스 사망·완료 처리 중 일시 DB 오류로
   *   `generating|regenerating`에 남은 행을 되살릴 방법이 전혀 없다. week_of가 unique라 다른 행으로
   *   우회할 수도 없어 그 주차가 DB 직접 수정 없이는 영구 차단된다(리컨사일은 잡이 남아 있을 때만 동작).
   *   `{generating|regenerating}→generation_failed`는 shared 전이맵상 합법이라 규칙 사본 없이 성립한다.
   */
  private async recoverStuck(
    existing: RecommendationRow,
    status: RecommendationStatus,
    user: User,
  ): Promise<RecommendationRow> {
    const elapsedMs = Date.now() - existing.updatedAt.getTime();
    const stuckMs = this.config.get('RECOMMENDATION_STUCK_MS', { infer: true });
    if (elapsedMs < stuckMs) {
      throw new DomainException('conflict', '해당 주차 추천을 이미 생성 중입니다', {
        id: existing.id,
        status,
      });
    }

    const elapsedSec = Math.round(elapsedMs / 1000);
    this.logger.warn(
      `추천 생성 고착 감지 (id=${existing.id}, status=${status}, ${elapsedSec}s) — 강제 실패 후 재시도`,
    );
    const hop = await this.workflow.applySystemTransition(
      existing.id,
      status,
      'generation_failed',
      recommendationJobId(existing.id, existing.generation),
      { note: `생성 고착 ${elapsedSec}초 — 강제 실패 후 재시도` },
    );
    if (!hop.applied) {
      // 그 사이 잡이 도착해 전진했다 — 뭉개지 않고 재조회를 유도한다
      throw new DomainException('conflict', '해당 주차 추천 상태가 방금 바뀌었습니다 — 재조회하세요', {
        id: existing.id,
        status,
      });
    }

    const failed = await this.workflow.load(existing.id);
    await this.prisma.$transaction((tx) => this.workflow.retryGeneration(tx, failed, user));
    return this.workflow.load(existing.id);
  }

  /**
   * 아직 반영되지 않은 수정요청(최신 1건) — 재시도 잡에 다시 실어준다.
   * ★ 없으면 총평의 `[재생성 gN — 수정 지시: …]` 접두가 사라지고(센터가 무엇을 반영한 세대인지 알 통로 상실)
   *   완주해도 RevisionRequest가 resolvedAt=null로 영구 잔류해 감사 귀속이 어긋난다.
   */
  private async pendingRevision(
    recommendationId: string,
  ): Promise<{ id: string; message: string } | null> {
    return this.prisma.revisionRequest.findFirst({
      where: { recommendationId, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, message: true },
    });
  }

  /** 커밋 후 트랜스포트 분기 — 큐면 인큐, 아니면 즉시 계산 후 같은 기록 경로로 반영 */
  private async dispatch(data: RecommendationJobData): Promise<void> {
    try {
      const inline = await this.producer.enqueueOrCompute(data);
      if (!inline) return; // 큐 경로 — 완료는 PipelineService가 반영
      await this.applyGenerationResult(
        data.recommendationId,
        data.generation,
        inline.jobId,
        inline.result,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`추천 생성 디스패치 실패 (id=${data.recommendationId}): ${message}`);
      // 고착 방지 — generating에 영구히 남기지 않는다(재시도 경로는 generation_failed→generating)
      await this.failGeneration(
        data.recommendationId,
        recommendationJobId(data.recommendationId, data.generation),
        message,
      ).catch(() => undefined);
    }
  }

  /** 신규 행 — 생성은 진입점이라 전이 로그 없음(content draft 선례) */
  private async createGenerating(weekOfDate: Date): Promise<RecommendationRow> {
    try {
      return await this.prisma.weeklyRecommendation.create({
        data: {
          id: newId(),
          weekOf: weekOfDate,
          status: 'generating',
          generation: 1,
          items: [],
        },
      });
    } catch (e) {
      // 동시 POST 경합 — week_of unique 위반이 하드가드
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new DomainException('conflict', '해당 주차 추천이 방금 생성되었습니다 — 재조회하세요');
      }
      throw e;
    }
  }
}
