import { Injectable } from '@nestjs/common';
import type { ContentStatus, User } from '@gachinol/shared';
import {
  afterReporterApproval,
  canTransitionContent,
  CONTENT_RETRY_TARGET,
  CONTENT_STATUS_TRANSITIONS,
  isFailureStatus,
  nextStates,
} from '@gachinol/shared';
import type { Content as ContentRow, Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateRevisionRequestDto } from './schemas/content.schemas';

/** 전이 액터 — phase-1 시스템 액터는 reporter approve 자동 연쇄뿐 (워커 도입 시 jobId 사용) */
export type TransitionActor =
  { type: 'user'; user: User } | { type: 'system'; jobId?: string; note?: string };

interface HopOpts {
  note?: string;
  /** 상태별 효과 외 추가 필드 (approve의 approvedByUserId 등) */
  mutate?: Prisma.ContentUncheckedUpdateManyInput;
}

type Tx = Prisma.TransactionClient;

const REPORTER_REVIEW_DECISIONS: readonly ContentStatus[] = [
  'reporter_approved',
  'revision_requested',
  'rejected',
];

/**
 * ★ 콘텐츠 상태 전이의 단일 관문.
 * 전이 규칙의 유일 원천은 shared(CONTENT_STATUS_TRANSITIONS·afterReporterApproval·
 * CONTENT_RETRY_TARGET) — api에 전이 규칙 사본 금지. 여기는 정책 가드 + 원자성(CAS) + 감사 로그만 얹는다.
 */
@Injectable()
export class ContentWorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 기자 승인(awaiting_reporter_review): reporter_approved → 같은 트랜잭션에서
   * afterReporterApproval(reviewPolicy) 자동 연쇄 (중간 상태 노출 없음, 로그 2건).
   * 센터 승인(awaiting_center_review): center_approved. publishing 자동 연쇄는 하지 않는다 —
   * 송출 트리거는 Distribute 단계의 몫.
   */
  async approve(contentId: string, user: User): Promise<ContentRow> {
    const content = await this.load(contentId);
    const from = content.status as ContentStatus;
    const actor: TransitionActor = { type: 'user', user };

    // to 결정 정책 — from 목록 하드코딩 대신 canTransitionContent가 최종 판정
    if (from === 'awaiting_center_review') {
      this.requireCenterActor(user);
      // 기존에는 이 분기가 policyGuard를 호출하지 않았다(원래 ①~③ 어느 것도 이 전이에 해당하지 않아서
      // 무해했다) — ④ 미성년자 동의 게이트가 바로 이 전이(승인 단계·센터 검토)를 1차 대상으로 삼으므로
      // 여기서도 호출해야 한다(그렇지 않으면 HTTP POST /:id/approve 경로가 게이트를 우회한다).
      this.policyGuard(content, from, 'center_approved', actor);
      this.assertAllowed(from, 'center_approved');
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await this.applyHop(tx, content, from, 'center_approved', actor, {
          mutate: { approvedByUserId: user.id, approvedAt: now },
        });
      });
      return this.load(contentId);
    }

    const to: ContentStatus = 'reporter_approved';
    this.policyGuard(content, from, to, actor);
    this.assertAllowed(from, to);

    const chained = afterReporterApproval(
      content.reviewPolicy as 'reporter_only' | 'reporter_then_center',
    );
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.applyHop(tx, content, from, to, actor, {
        mutate: { approvedByUserId: user.id, approvedAt: now },
      });
      // 자동 연쇄 — 2건째 로그는 system 액터
      await this.applyHop(
        tx,
        content,
        to,
        chained,
        { type: 'system' },
        { note: `reviewPolicy=${content.reviewPolicy} 자동 진행` },
      );
    });
    return this.load(contentId);
  }

  /** 수정 요청 — RevisionRequest 생성과 동일 트랜잭션 (revision_requested 전이의 유일 경로) */
  async requestRevision(
    contentId: string,
    user: User,
    body: CreateRevisionRequestDto,
  ): Promise<ContentRow> {
    const content = await this.load(contentId);
    const from = content.status as ContentStatus;
    const to: ContentStatus = 'revision_requested';
    const actor: TransitionActor = { type: 'user', user };

    this.policyGuard(content, from, to, actor);
    if (from === 'awaiting_center_review') this.requireCenterActor(user);
    this.assertAllowed(from, to);

    // requesterRole은 인증 role 매핑 — body로 받지 않는다
    const requesterRole = user.role === 'reporter' ? 'reporter' : 'center_operator';

    await this.prisma.$transaction(async (tx) => {
      await this.applyHop(tx, content, from, to, actor, { note: body.note.slice(0, 200) });
      await tx.revisionRequest.create({
        data: {
          id: uuidv7(),
          targetKind: 'content',
          contentId: content.id,
          requestedByUserId: user.id,
          requesterRole,
          message: body.note,
          sceneNotes: body.sceneNotes
            ? (body.sceneNotes as unknown as Prisma.InputJsonValue)
            : undefined,
        },
      });
    });
    return this.load(contentId);
  }

  /** 반려 [종결] — 사유 필수. 재작업은 새 콘텐츠 + remakeOfContentId */
  async reject(contentId: string, user: User, note: string): Promise<ContentRow> {
    const content = await this.load(contentId);
    const from = content.status as ContentStatus;
    const to: ContentStatus = 'rejected';
    const actor: TransitionActor = { type: 'user', user };

    this.policyGuard(content, from, to, actor);
    if (from === 'awaiting_center_review') this.requireCenterActor(user);
    this.assertAllowed(from, to);

    await this.prisma.$transaction(async (tx) => {
      await this.applyHop(tx, content, from, to, actor, { note });
    });
    return this.load(contentId);
  }

  /** 취소 [종결] — 전이 맵상 canceled로 갈 수 있는 모든 상태 (맵이 유일 진실 — from 하드코딩 금지) */
  async cancel(contentId: string, user: User, note?: string): Promise<ContentRow> {
    const content = await this.load(contentId);
    const from = content.status as ContentStatus;
    const to: ContentStatus = 'canceled';
    const actor: TransitionActor = { type: 'user', user };

    this.requireOwnerOrCenter(content, user);
    this.assertAllowed(from, to);

    await this.prisma.$transaction(async (tx) => {
      await this.applyHop(tx, content, from, to, actor, { note });
    });
    return this.load(contentId);
  }

  /** 재시도 — 목적지는 shared CONTENT_RETRY_TARGET이 유일 원천. Job 재큐는 큐 단계 훅 */
  async retry(contentId: string, user: User): Promise<ContentRow> {
    const content = await this.load(contentId);
    const from = content.status as ContentStatus;

    if (!isFailureStatus(from)) {
      throw new DomainException(
        'invalid_transition',
        `재시도 가능한 실패 상태가 아닙니다: ${from}`,
        {
          from,
          allowed: Object.keys(CONTENT_RETRY_TARGET),
        },
      );
    }
    // 소유 reporter는 upload_failed만, 그 외 실패는 center_operator·admin
    if (user.role === 'reporter') {
      this.requireOwnerReporter(content, user);
      if (from !== 'upload_failed') {
        throw new DomainException('forbidden', '기자는 upload_failed만 재시도할 수 있습니다');
      }
    } else {
      this.requireCenterActor(user);
    }

    const to = CONTENT_RETRY_TARGET[from as keyof typeof CONTENT_RETRY_TARGET];
    this.assertAllowed(from, to);

    await this.prisma.$transaction(async (tx) => {
      await this.applyHop(tx, content, from, to, { type: 'user', user }, {});
      // 재큐: ContentsController.retry가 커밋 후 QueueProducerService.requeueForStatus로 수행(인큐-애프터-커밋)
    });
    return this.load(contentId);
  }

  /**
   * 범용 전이 — 워커 부재 기간 파이프라인 수동 진행·시뮬레이션·운영 복구 (admin·center_operator).
   * §11-4 정책 가드 동일 적용 — 관리자라도 계약 위반 전이는 불가.
   * 워커 도입 시 시스템 전이는 내부 인증 경로로 이관(미결).
   */
  async transition(
    contentId: string,
    to: ContentStatus,
    user: User,
    note?: string,
  ): Promise<ContentRow> {
    const content = await this.load(contentId);
    const from = content.status as ContentStatus;
    const actor: TransitionActor = { type: 'user', user };

    if (to === 'revision_requested') {
      // RevisionRequest 생성과 동일 트랜잭션 강제 — request-revision 엔드포인트로만
      throw new DomainException(
        'forbidden',
        'revision_requested 전이는 POST /v1/contents/:id/request-revision으로만 가능합니다',
      );
    }
    this.policyGuard(content, from, to, actor);
    this.assertAllowed(from, to);

    // center_approved는 경로와 무관하게 승인자 기록 — approve()와 동일 효과 (감사 필드 경로 독립)
    const mutate: Prisma.ContentUncheckedUpdateManyInput | undefined =
      to === 'center_approved' ? { approvedByUserId: user.id, approvedAt: new Date() } : undefined;

    await this.prisma.$transaction(async (tx) => {
      await this.applyHop(tx, content, from, to, actor, { note, mutate });
    });
    return this.load(contentId);
  }

  /**
   * 시스템 액터 전이 — QueueEvents 소비자(PipelineService) 전용. HTTP 컨트롤러에 연결하지 않는다.
   * 멱등·순서무관: 현재 status가 expectedFrom이 아니면(재전송·경합·추월) 무해 무시 → {applied:false}.
   * ensure 체이닝: 연속 호출로 유실/재수신을 수렴 (예: uploaded→processing 후 processing→preview_generating).
   */
  async applySystemTransition(
    contentId: string,
    expectedFrom: ContentStatus,
    to: ContentStatus,
    jobId: string,
    opts: { note?: string; mutate?: Prisma.ContentUncheckedUpdateManyInput } = {},
  ): Promise<{ applied: boolean }> {
    const content = await this.load(contentId);
    const from = content.status as ContentStatus;
    if (from !== expectedFrom) return { applied: false }; // 재전송/추월 → no-op

    const actor: TransitionActor = { type: 'system', jobId };
    this.policyGuard(content, from, to, actor); // origin 가드 유효(user 분기는 system이라 skip)
    this.assertAllowed(from, to); // 맵 합법성

    const applied = await this.prisma.$transaction((tx) =>
      this.applyHop(tx, content, from, to, actor, opts, /* idempotent */ true),
    );
    return { applied };
  }

  /**
   * 송출 트리거 CAS — center_approved → publishing (센터 액터). 트리거 멱등의 1차 관문:
   * 동시/중복 distribute 중 하나만 승리(count=0이면 applyHop이 409 conflict throw).
   * 규칙은 shared assertAllowed(center_approved→publishing)로 검증(사본 없음). Publication 생성과 동일 tx에서 호출.
   * publishing 자동 연쇄는 없다 — 실제 채널 송출은 Distribute 생산자(인큐-애프터-커밋)의 몫.
   */
  async beginPublishing(tx: Tx, content: ContentRow, user: User): Promise<void> {
    const from: ContentStatus = 'center_approved';
    const to: ContentStatus = 'publishing';
    this.requireCenterActor(user);
    this.assertAllowed(from, to);
    await this.applyHop(tx, content, from, to, { type: 'user', user }, {});
  }

  /**
   * 채널 단위 재시도 시 content publish_failed → publishing 복귀 (센터 액터).
   * 이미 publishing(다른 채널이 진행 중)이면 무해 skip. idempotent CAS라 경합도 무해.
   */
  async resumePublishing(tx: Tx, content: ContentRow, user: User): Promise<void> {
    if (content.status !== 'publish_failed') return; // 이미 publishing 등 — skip
    const from: ContentStatus = 'publish_failed';
    const to: ContentStatus = 'publishing';
    this.requireCenterActor(user);
    this.assertAllowed(from, to);
    await this.applyHop(tx, content, from, to, { type: 'user', user }, {}, /* idempotent */ true);
  }

  /** 업로드 시작 — {draft|upload_failed} → uploading (소유 기자). 자산 생성·인큐는 UploadService 몫 */
  async beginUpload(contentId: string, user: User): Promise<ContentRow> {
    return this.userHop(contentId, user, 'uploading');
  }

  /** 업로드 완료 — uploading → uploaded (소유 기자) */
  async completeUpload(contentId: string, user: User): Promise<ContentRow> {
    return this.userHop(contentId, user, 'uploaded');
  }

  /** 업로드 실패 — uploading → upload_failed (소유 기자). 오브젝트 검증 실패 시 교착 회피 */
  async failUpload(contentId: string, user: User): Promise<ContentRow> {
    return this.userHop(contentId, user, 'upload_failed');
  }

  private async userHop(contentId: string, user: User, to: ContentStatus): Promise<ContentRow> {
    const content = await this.load(contentId);
    const from = content.status as ContentStatus;
    this.requireOwnerReporter(content, user);
    this.assertAllowed(from, to);
    await this.prisma.$transaction(async (tx) => {
      await this.applyHop(tx, content, from, to, { type: 'user', user }, {});
    });
    return this.load(contentId);
  }

  // ── 내부 ──────────────────────────────────────────────

  private async load(contentId: string): Promise<ContentRow> {
    const content = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!content) throw new DomainException('not_found', '콘텐츠를 찾을 수 없습니다');
    return content;
  }

  private assertAllowed(from: ContentStatus, to: ContentStatus): void {
    if (!canTransitionContent(from, to)) {
      throw new DomainException('invalid_transition', `허용되지 않는 전이: ${from} → ${to}`, {
        from,
        to,
        allowed: nextStates(CONTENT_STATUS_TRANSITIONS, from),
      });
    }
  }

  /**
   * §11-4 정책 가드 — 전이 맵(구조적 상한) 위의 서버 몫.
   * ① preview_generating→awaiting_reporter_review: origin='reporter_upload'만
   * ② preview_generating→awaiting_center_review: origin∈{'live_vod','resident_link'} (기자 승인 생략 경로 —
   *    두 유래 모두 담당 기자가 없다(reporterId=null 불변식, shared content.ts 주석). resident_link 출구는
   *    대장 #87(T-W2-13 편입분) — T-W2-08이 ContentOrigin에 resident_link를 추가하며 preview_generating의
   *    두 출구(reporter_upload 전용·live_vod 전용) 중 어느 쪽도 못 타는 사각이 생겼던 것을 해소한다.
   *    awaiting_reporter_review는 아래 ③의 requireOwnerReporter가 reporterId===user.id를 요구하므로
   *    reporterId=null인 두 유래는 애초에 그 경로를 완주할 수 없다(선택의 여지 없이 center 경로가 유일해).
   * ③ awaiting_reporter_review 계열 결정(승인·수정요청·반려)의 user 액터는 담당 기자만
   * ④ 미성년자(만 14세 미만) 피촬영자 동의 게이트 (07 §3-3·02 §E-20, T-W2-13 본체, fail-closed) —
   *    hasMinorSubject && !minorConsentConfirmedAt이면 "승인"을 차단한다. 정본 문언의 1차 대상은
   *    승인 단계(센터 검토: awaiting_center_review→center_approved)다. 다만 reviewPolicy='reporter_only'는
   *    센터 검토를 아예 거치지 않고 reporter_approved가 같은 트랜잭션에서 즉시 publishing으로 자동
   *    연쇄되므로(afterReporterApproval) — 그 경로에서는 awaiting_reporter_review→reporter_approved가
   *    실질적인 "승인"(더 이상의 인간 검토 없이 송출 확정)이라 동일 게이트를 적용한다. 그렇지 않으면
   *    미성년자 플래그가 켜진 콘텐츠가 동의 확인 없이 공개 송출로 직행해 게이트 취지가 무력화된다.
   *    reviewPolicy='reporter_then_center'의 reporter_approved는 이후 센터 게이트가 다시 잡으므로
   *    대상에서 제외(중복 차단 불필요, 기자 자신의 검토 단계는 그대로 통과 — AC5 회귀 금지 대상 아님).
   */
  private policyGuard(
    content: ContentRow,
    from: ContentStatus,
    to: ContentStatus,
    actor: TransitionActor,
  ): void {
    if (from === 'preview_generating' && to === 'awaiting_reporter_review') {
      if (content.origin !== 'reporter_upload') {
        throw new DomainException(
          'invalid_transition',
          "origin='live_vod'는 기자 검토를 생략하고 센터 검토로 직행합니다",
          { from, to, origin: content.origin },
        );
      }
    }
    if (from === 'preview_generating' && to === 'awaiting_center_review') {
      if (content.origin !== 'live_vod' && content.origin !== 'resident_link') {
        throw new DomainException(
          'invalid_transition',
          "origin='reporter_upload'는 기자 검토(awaiting_reporter_review)를 거쳐야 합니다",
          { from, to, origin: content.origin },
        );
      }
    }
    if (
      from === 'awaiting_reporter_review' &&
      REPORTER_REVIEW_DECISIONS.includes(to) &&
      actor.type === 'user'
    ) {
      this.requireOwnerReporter(content, actor.user);
    }
    const isCenterApproval = from === 'awaiting_center_review' && to === 'center_approved';
    const isReporterOnlyTerminalApproval =
      from === 'awaiting_reporter_review' &&
      to === 'reporter_approved' &&
      content.reviewPolicy === 'reporter_only';
    if (
      (isCenterApproval || isReporterOnlyTerminalApproval) &&
      content.hasMinorSubject &&
      !content.minorConsentConfirmedAt
    ) {
      throw new DomainException(
        'invalid_transition',
        '피촬영자 만 14세 미만 플래그가 켜져 있습니다 — 법정대리인 동의서 확인 전에는 승인할 수 없습니다',
        { from, to, hasMinorSubject: true },
      );
    }
  }

  private requireOwnerReporter(content: ContentRow, user: User): void {
    if (!(user.role === 'reporter' && content.reporterId === user.id)) {
      throw new DomainException(
        'forbidden',
        '기자 검토 단계 액션은 담당 기자만 수행할 수 있습니다',
      );
    }
  }

  private requireCenterActor(user: User): void {
    if (user.role !== 'center_operator' && user.role !== 'admin') {
      throw new DomainException('forbidden', '센터 운영자 또는 관리자만 수행할 수 있습니다');
    }
  }

  private requireOwnerOrCenter(content: ContentRow, user: User): void {
    if (user.role === 'reporter') {
      this.requireOwnerReporter(content, user);
      return;
    }
    this.requireCenterActor(user);
  }

  /**
   * 단일 홉 실행 — 낙관적 CAS(조건부 UPDATE) + 상태별 효과 + 감사 로그.
   * affected 0이면 동시 경합 → 409 conflict (규칙 위반 invalid_transition과 구분 — 클라이언트 대응이 다르다).
   */
  private async applyHop(
    tx: Tx,
    content: ContentRow,
    from: ContentStatus,
    to: ContentStatus,
    actor: TransitionActor,
    opts: HopOpts,
    idempotent = false,
  ): Promise<boolean> {
    const now = new Date();
    const data: Prisma.ContentUncheckedUpdateManyInput = { status: to, ...(opts.mutate ?? {}) };
    // 상태별 효과 (shared 규약)
    if (to === 'published' && !content.publishedAt) data.publishedAt = now; // 비정규화: 최초 송출 시각
    if (to === 'regenerating') data.generation = { increment: 1 }; // 산출물 세대 +1

    const res = await tx.content.updateMany({ where: { id: content.id, status: from }, data });
    if (res.count === 0) {
      // 시스템 경로(idempotent): 이미 적용됨/경합 → 무해 무시(로그 미기록). 사용자 경로: 409 그대로
      if (idempotent) return false;
      throw new DomainException('conflict', '동시 전이 경합 — 재조회 후 재시도하세요', {
        from,
        to,
      });
    }

    await tx.statusTransitionLog.create({
      data: {
        id: uuidv7(),
        entityType: 'content',
        entityId: content.id,
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
