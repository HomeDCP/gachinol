import { Injectable } from '@nestjs/common';
import type { RecommendationStatus, User } from '@gachinol/shared';
import { nextStates, RECOMMENDATION_STATUS_TRANSITIONS } from '@gachinol/shared';
import type { Prisma, WeeklyRecommendation as RecommendationRow } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { newId } from '../common/ids';
import { PrismaService } from '../prisma/prisma.service';
import { canTransitionRecommendation } from './recommendation-status';

export type RecommendationActor =
  | { type: 'user'; user: User }
  | { type: 'system'; jobId?: string };

interface HopOpts {
  note?: string;
  /** 상태별 효과 외 추가 필드 (approve의 approvedByUserId 등) */
  mutate?: Prisma.WeeklyRecommendationUncheckedUpdateManyInput;
}

type Tx = Prisma.TransactionClient;

/**
 * ★ 주간추천 상태 전이의 단일 관문 (ContentWorkflowService 동형).
 * 전이 규칙의 유일 원천은 shared RECOMMENDATION_STATUS_TRANSITIONS — api에 규칙 사본 금지.
 * 여기는 정책 가드(센터 액터) + 원자성(CAS) + 감사 로그(entityType='weekly_recommendation')만 얹는다.
 * 범용 transition 엔드포인트는 만들지 않는다 — 각 전이는 전용 진입점으로만 도달한다.
 */
@Injectable()
export class RecommendationWorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  /** 실패 재시도 — generation_failed → generating (세대 유지). 경합 시 409 */
  async retryGeneration(tx: Tx, row: RecommendationRow, user: User): Promise<void> {
    this.requireCenterActor(user);
    await this.userHop(tx, row, 'generation_failed', 'generating', user, {});
  }

  /** 센터 승인 — pending_review → approved. 송출 자동 연쇄 없음(publishing 배선은 후속) */
  async approve(tx: Tx, row: RecommendationRow, user: User): Promise<void> {
    this.requireCenterActor(user);
    await this.userHop(tx, row, 'pending_review', 'approved', user, {
      mutate: { approvedByUserId: user.id, approvedAt: new Date() },
    });
  }

  /** 수정 요청 — pending_review → revision_requested. RevisionRequest 생성과 동일 tx에서만 호출 */
  async requestRevision(
    tx: Tx,
    row: RecommendationRow,
    user: User,
    note: string,
  ): Promise<void> {
    this.requireCenterActor(user);
    await this.userHop(tx, row, 'pending_review', 'revision_requested', user, {
      note: note.slice(0, 200),
    });
  }

  /**
   * 자동 연쇄 — revision_requested → regenerating (system 액터, generation+1).
   * 맵상 revision_requested의 유일한 전진 경로라 사용자에게 중간 상태를 노출할 이유가 없다
   * (ContentWorkflowService.approve의 afterReporterApproval 연쇄 선례 — 로그 2건, 2번째 system).
   */
  async beginRegeneration(tx: Tx, row: RecommendationRow, note: string): Promise<void> {
    const from: RecommendationStatus = 'revision_requested';
    const to: RecommendationStatus = 'regenerating';
    this.assertAllowed(from, to);
    await this.applyHop(tx, row, from, to, { type: 'system' }, { note: note.slice(0, 200) });
  }

  /**
   * 시스템 액터 전이 — 잡 이벤트 소비자(PipelineService)·인라인 폴백 전용. HTTP 미노출.
   * 멱등·순서무관: 현재 status가 expectedFrom이 아니면(재전송·경합·추월) 무해 무시 → {applied:false}.
   */
  async applySystemTransition(
    recommendationId: string,
    expectedFrom: RecommendationStatus,
    to: RecommendationStatus,
    jobId: string,
    opts: HopOpts = {},
  ): Promise<{ applied: boolean }> {
    const row = await this.load(recommendationId);
    const from = row.status as RecommendationStatus;
    if (from !== expectedFrom) return { applied: false }; // 재전송/추월 → no-op
    this.assertAllowed(from, to);

    const applied = await this.prisma.$transaction((tx) =>
      this.applyHop(tx, row, from, to, { type: 'system', jobId }, opts, /* idempotent */ true),
    );
    return { applied };
  }

  async load(recommendationId: string): Promise<RecommendationRow> {
    const row = await this.prisma.weeklyRecommendation.findUnique({
      where: { id: recommendationId },
    });
    if (!row) throw new DomainException('not_found', '주간 추천을 찾을 수 없습니다');
    return row;
  }

  requireCenterActor(user: User): void {
    if (user.role !== 'center_operator' && user.role !== 'admin') {
      throw new DomainException('forbidden', '센터 운영자 또는 관리자만 수행할 수 있습니다');
    }
  }

  assertAllowed(from: RecommendationStatus, to: RecommendationStatus): void {
    if (!canTransitionRecommendation(from, to)) {
      throw new DomainException('invalid_transition', `허용되지 않는 전이: ${from} → ${to}`, {
        from,
        to,
        allowed: nextStates(RECOMMENDATION_STATUS_TRANSITIONS, from),
      });
    }
  }

  // ── 내부 ──────────────────────────────────────────────

  private async userHop(
    tx: Tx,
    row: RecommendationRow,
    expectedFrom: RecommendationStatus,
    to: RecommendationStatus,
    user: User,
    opts: HopOpts,
  ): Promise<void> {
    const from = row.status as RecommendationStatus;
    if (from !== expectedFrom) {
      // "지금은 그 단계가 아님" — 규칙 위반(invalid_transition)과 구분한다(클라 대응이 다르다)
      throw new DomainException('conflict', `${expectedFrom} 상태에서만 가능합니다`, {
        status: from,
        expected: expectedFrom,
      });
    }
    this.assertAllowed(from, to);
    await this.applyHop(tx, row, from, to, { type: 'user', user }, opts);
  }

  /**
   * 단일 홉 — 낙관적 CAS(조건부 UPDATE) + 상태별 효과 + 감사 로그.
   * affected 0이면 동시 경합 → user 경로 409 conflict / system 경로 무해 no-op.
   */
  private async applyHop(
    tx: Tx,
    row: RecommendationRow,
    from: RecommendationStatus,
    to: RecommendationStatus,
    actor: RecommendationActor,
    opts: HopOpts,
    idempotent = false,
  ): Promise<boolean> {
    const now = new Date();
    const data: Prisma.WeeklyRecommendationUncheckedUpdateManyInput = {
      status: to,
      ...(opts.mutate ?? {}),
    };
    // 상태별 효과 — 재생성 세대 +1 (Content.regenerating 선례)
    if (to === 'regenerating') data.generation = { increment: 1 };

    const res = await tx.weeklyRecommendation.updateMany({
      where: { id: row.id, status: from },
      data,
    });
    if (res.count === 0) {
      if (idempotent) return false;
      throw new DomainException('conflict', '동시 전이 경합 — 재조회 후 재시도하세요', { from, to });
    }

    await tx.statusTransitionLog.create({
      data: {
        id: newId(),
        entityType: 'weekly_recommendation',
        entityId: row.id,
        fromStatus: from,
        toStatus: to,
        actorType: actor.type,
        // shared 불변식: actorType='user' ⇒ actorUserId 필수
        actorUserId: actor.type === 'user' ? actor.user.id : null,
        jobId: actor.type === 'system' ? (actor.jobId ?? null) : null,
        note: opts.note ?? null,
        at: now,
      },
    });
    return true;
  }
}
