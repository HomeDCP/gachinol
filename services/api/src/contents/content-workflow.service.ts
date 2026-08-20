import { Injectable, Logger } from '@nestjs/common';
import type { ContentStatus, User } from '@gachinol/shared';
import {
  afterReporterApproval,
  canTransitionContent,
  CONTENT_RETRY_TARGET,
  CONTENT_STATUS_TRANSITIONS,
  isFailureStatus,
  isMinorConsentPending,
  nextStates,
} from '@gachinol/shared';
import type { Content as ContentRow, Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { DomainException } from '../common/errors/domain.exception';
import { PublicMediaService } from '../media/public-media.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertResidentReviewApproved,
  isPipelineEntryEdge,
} from '../resident-links/resident-review.gate';
import type { CreateRevisionRequestDto } from './schemas/content.schemas';
import { recordContentTransition } from './transition-probe';

/**
 * 전이 액터. 시스템 액터의 `jobId`가 **선택**인 이유: 잡이 낳지 않은 시스템 전이가 있다.
 * · 잡 유래 — 큐 이벤트 소비자(`PipelineService`)·추천 워커. jobId를 싣는다.
 * · 잡 없음 — 사람이 방아쇠를 당겼지만 그 사람이 **그 콘텐츠의 액터가 될 수 없는** 경우
 *   (`cancelBySystem`: 주민 업로드 반려에 따른 무주 콘텐츠 종결, T-W2-31). jobId는 null이고
 *   방아쇠를 당긴 사람은 `note`로 남는다 — `status_transition_logs`의 불변식이
 *   "actorType='user' ⇒ actorUserId 필수"라 system 행에는 사용자 id를 실을 자리가 없다.
 */
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
  private readonly logger = new Logger(ContentWorkflowService.name);

  // publicMedia는 선택 의존(테스트 하위호환 — 기존 `new ContentWorkflowService(prisma)` 호출부가
  // 여럿 있고 DI 컨테이너 밖에서 직접 생성한다). 실 앱에서는 ContentsModule이 MediaModule을
  // import하므로 Nest가 항상 주입한다 — undefined는 순수 단위 테스트에서만 발생.
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicMedia?: PublicMediaService,
  ) {}

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

  /**
   * 재생성 시작 — `revision_requested → regenerating` (대장 #98 종결).
   *
   * ★ **수정요청과 자동 연쇄하지 않는 이유**: `revision_requested`는 서버가 초안 수정을 허용하는
   * 상태다(`ContentsService.EDITABLE_STATUSES`). 수정요청과 동시에 재생성이 돌면 기자가 자막·제목을
   * 고칠 기회가 사라진다 — 실제 작업 순서는 "지적을 읽고 → 고치고 → 다시 만들기"다.
   * 그래서 자동 체인이 아니라 **명시적 트리거**로 둔다.
   *
   * 잡 인큐는 커밋 후 컨트롤러가 수행한다(인큐-애프터-커밋). 세대 +1과 미성년자 동의 무효화는
   * `applyHop`의 `to === 'regenerating'` 효과가 담당한다.
   */
  async regenerate(contentId: string, user: User): Promise<ContentRow> {
    const content = await this.load(contentId);
    const from = content.status as ContentStatus;
    const to: ContentStatus = 'regenerating';
    const actor: TransitionActor = { type: 'user', user };

    this.policyGuard(content, from, to, actor);
    this.assertAllowed(from, to);

    await this.prisma.$transaction(async (tx) => {
      await this.applyHop(tx, content, from, to, actor, {});
    });
    return this.load(contentId);
  }

  /**
   * 재생성 완료 시 이 콘텐츠의 **미해결 수정요청을 전부** 해소한다.
   *
   * ★ `contentId` 기준인 이유(payload의 revisionRequestId가 아니라): 재시도 경로
   * (`QueueProducerService.requeueForStatus`)는 그 id를 실을 방법이 없어 payload를 원천으로 삼으면
   * 재시도 한 번에 해소 레코드가 유실된다. 추천 도메인이 같은 함정을 겪고 같은 결론에 도달했다.
   * 여러 건이 쌓여 있었다면 재생성 1회가 전부를 닫는 것이 맞다 — 산출물이 하나뿐이기 때문이다.
   */
  async resolveRevisionRequests(contentId: string, jobId: string): Promise<number> {
    const res = await this.prisma.revisionRequest.updateMany({
      where: { targetKind: 'content', contentId, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedByJobId: jobId },
    });
    if (res.count > 0) {
      this.logger.log(`수정요청 ${res.count}건 해소 (contentId=${contentId}, jobId=${jobId})`);
    }
    return res.count;
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
    // 커밋 후 훅(인큐-애프터-커밋 동형) — 공개 렌디션 캐시 서빙(D-T8, T-W2-10).
    // `transition()`은 published·archived 양쪽 다 도달 가능한 유일한 공용 경로다: published는
    // 워커 부재기 수동 복구(§11-4 범용 전이)로, archived는 보관 구동부 부재로 **유일** 경로다
    // (packages/shared/src/content/not-wired.ts published→archived 항목 참조).
    if (to === 'published') await this.syncPublicMediaAfterPublish(contentId, content.generation);
    if (to === 'archived') await this.removePublicMediaAfterArchive(contentId, content.generation);
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
    // 커밋 후 훅(인큐-애프터-커밋 동형) — publishing→published는 이 경로가 정상계(PipelineService.
    // onPublishCompleted)다. applied=false(재전송·경합·이미 적용됨)면 실제로 전이가 일어나지
    // 않았으므로 재복사하지 않는다(중복 호출 방지 — S3 복사 자체는 멱등이라 안전하지만 불필요한 I/O).
    if (applied && to === 'published') {
      await this.syncPublicMediaAfterPublish(contentId, content.generation);
    }
    return { applied };
  }

  /**
   * ★ 무주(unowned) 콘텐츠의 시스템 종결 — `expectedFrom` → canceled, **호출자 트랜잭션 안에서**
   * (T-W2-31, 대장 #112). `beginPublishing`·`resumePublishing`과 같은 tx-수취 형태다.
   *
   * ── 왜 `cancel()`이 아니라 이것인가 ────────────────────────────────────────
   * `cancel()`은 `requireOwnerOrCenter`로 **사용자 액터**를 요구한다. `origin='resident_link'`
   * 콘텐츠는 shared 불변식상 `reporterId=null`(무주)이라 소유 기자 판정을 통과할 수 없고, 검수자는
   * 지사 기자(`reporter`)라 센터 액터도 아니다. 액터 판정을 완화하면 **모든** 무주 콘텐츠에 대한
   * 기자 취소 권한이 열리므로(주민 링크와 무관한 `live_vod`까지), 완화 대신 액터를 system으로 둔다.
   *
   * ── 감사 (한계 포함) ──────────────────────────────────────────────────────
   * actorType='system' ⇒ `actorUserId`는 null이다(shared 불변식). 그래서 **방아쇠를 당긴 사람과
   * 사유는 `note` 문자열에만** 남는다 — 구조화 컬럼이 아니라 질의로 집계할 수 없다. 반려 사유를
   * 컬럼으로 보존하는 것은 별건(대장 #113)이며 여기서 만들지 않는다. 검수자 id는 `resident_uploads.
   * reviewed_by_user_id`에 구조화돼 있으므로 역추적 자체는 그쪽과 이 note를 함께 보면 가능하다.
   *
   * ── 멱등·비파괴 ───────────────────────────────────────────────────────────
   * 콘텐츠가 이미 `expectedFrom`을 떠났으면(다른 경로로 진행·종결됨) **덮어쓰지 않고** no-op이다
   * (`ResidentReviewsService.enterPipeline`이 재인큐를 막는 판단과 같다). 행이 아예 없어도 no-op —
   * 여기서 404를 던지면 이미 커밋 대상인 검수 결정까지 함께 롤백된다(반려는 막히면 안 된다).
   * 반환의 `status`는 **이 호출 후 그 콘텐츠의 상태**(no-op이면 관측된 현재 상태, 행 부재면 null)라
   * 호출부가 "왜 안 됐는지"를 재조회 없이 로그로 남길 수 있다.
   */
  async cancelBySystem(
    tx: Tx,
    contentId: string,
    expectedFrom: ContentStatus,
    note: string,
  ): Promise<{ applied: boolean; status: ContentStatus | null }> {
    const content = await tx.content.findUnique({ where: { id: contentId } });
    if (!content) return { applied: false, status: null };

    const from = content.status as ContentStatus;
    if (from !== expectedFrom) return { applied: false, status: from };

    const to: ContentStatus = 'canceled';
    const actor: TransitionActor = { type: 'system' };
    this.policyGuard(content, from, to, actor);
    this.assertAllowed(from, to);

    // idempotent=true — 같은 tx 밖의 동시 전이가 먼저 이겨 CAS가 0행이면 409를 던지지 않고 no-op.
    // 반려(검수 결정)는 인프라·경합 사정으로 막혀서는 안 된다(07 §3-15 "즉시 반려").
    const applied = await this.applyHop(tx, content, from, to, actor, { note }, true);
    return { applied, status: applied ? to : from };
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
    // 판정 술어는 shared `isMinorConsentPending` 하나뿐(T-W2-27) — 관제 보드의 발견 수단
    // (목록 필터·배지)이 같은 술어에서 파생하므로 "무엇이 차단인가"가 서버·UI에서 갈릴 수 없다.
    if ((isCenterApproval || isReporterOnlyTerminalApproval) && isMinorConsentPending(content)) {
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
    // ★ 주민 업로드 검수 게이트 (03 §C-5 · 대장 #86) — 여기가 배선 지점인 이유:
    // applyHop은 콘텐츠 전이의 **단일 관문**이라, 이 한 줄이 파이프라인 시스템 전이·범용 수동 전이·
    // 재시도·앞으로 생길 모든 경로를 동시에 덮는다(호출부마다 가드를 심는 방식은 새 호출부가 생길 때
    // 조용히 뚫린다). 대상 엣지가 아니거나 origin이 주민 유래가 아니면 DB를 치지 않는다 = 기존 경로 무영향.
    // 판정·예외는 resident-links가 소유한다(사본 0) — 여기는 "언제 묻는가"만 결정한다.
    if (isPipelineEntryEdge(from, to)) {
      await assertResidentReviewApproved(tx, { id: content.id, origin: content.origin });
    }

    const now = new Date();
    const data: Prisma.ContentUncheckedUpdateManyInput = { status: to, ...(opts.mutate ?? {}) };
    // 상태별 효과 (shared 규약)
    if (to === 'published' && !content.publishedAt) data.publishedAt = now; // 비정규화: 최초 송출 시각
    if (to === 'regenerating') {
      data.generation = { increment: 1 }; // 산출물 세대 +1
      // ★ 대장 #117 — 미성년자 동의 확인은 generation-scoped가 아니다.
      // 세대가 올라가면 그것은 **다른 영상**이고 센터는 그 영상의 동의서를 본 적이 없다.
      // 등재 당시 "재생성 워커가 미구동이라 잠복"이라 적혀 있었는데, auto_edit 구동으로
      // 그 잠복 조건이 사라지므로 같은 슬라이스에서 닫는다.
      //
      // ⚠️ 지금은 **보수적으로 매번 무효화**한다. 승인된 계획(§5-D)은 "화면 구성(editPlan)이
      // 실제로 바뀐 재생성만 무효화"라는 완화안이지만, 07 법무가 이 게이트를 최상위 블로커로
      // 다루므로 **정본 대조 전에는 좁히지 않는다**. 대조 후 조건을 좁히는 것이 안전한 순서다.
      // (Phase 1은 editPlan이 항상 null이라 완화안을 적용해도 결과가 같다 — 실질 차이는
      //  컷이 들어오는 T-AI 트랙부터 생긴다.)
      if (content.hasMinorSubject) {
        data.minorConsentConfirmedByUserId = null;
        data.minorConsentConfirmedAt = null;
      }
    }

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
    // 미구동 계약 계측(EXEC-DECISIONS #29 1계층) — 테스트 외 환경에서는 본문 없는 함수다.
    // CAS 성공·감사 로그 기록 이후에만 부른다: 실제로 적용된 홉만 "관측"으로 센다(경합 no-op 제외).
    recordContentTransition(from, to);
    return true;
  }

  /**
   * 발행(published) 커밋 후 훅 — 공개 렌디션 복사(D-T8). PublicMediaService 내부에서 이미
   * per-asset best-effort(개별 실패를 삼키고 로그)이지만, 여기서도 방어적으로 감싼다 — 이 훅의
   * 실패가 publishing→published 전이 응답 자체를 실패시켜서는 안 된다(전이는 이미 커밋됐다).
   */
  private async syncPublicMediaAfterPublish(contentId: string, generation: number): Promise<void> {
    if (!this.publicMedia) return;
    try {
      await this.publicMedia.syncPublishedCopies(contentId, generation);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`공개 렌디션 동기화 훅 실패(content=${contentId}): ${message}`);
    }
  }

  /**
   * 보관(archived) 커밋 후 훅 — 공개 객체 제거 + CF 캐시 퍼지(D-T8 필수 대칭, 선택적 정리 아님).
   * PublicMediaService 내부에서 이미 throw하지 않지만, 동일한 이유로 여기서도 방어적으로 감싼다.
   */
  private async removePublicMediaAfterArchive(
    contentId: string,
    generation: number,
  ): Promise<void> {
    if (!this.publicMedia) return;
    try {
      await this.publicMedia.removePublishedCopies(contentId, generation);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`공개 렌디션 제거 훅 실패(content=${contentId}): ${message}`);
    }
  }
}
