import { Injectable, Logger } from '@nestjs/common';
import type { Paginated, User } from '@gachinol/shared';
import { isReporterUser } from '@gachinol/shared';
import type { Prisma, ResidentUpload as ResidentUploadRow } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { toPaginated, toSkipTake } from '../common/pagination/pagination.util';
import { MediaAssetsService } from '../media/media-assets.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueProducerService } from '../queue/queue-producer.service';
import { ResidentLinksService } from './resident-links.service';
import {
  canTransitionResidentUpload,
  RESIDENT_UPLOAD_STATUS_TRANSITIONS,
  ResidentUploadStatus,
} from './resident-upload-status';
import type { ResidentReviewQueryDto } from './schemas/resident-review.schemas';

/* ══════════════════════════════════════════════════════════════════════════
 * 주민 업로드 검수 (T-W2-24 — 대장 #86 · #103⑥ · 03 §C-5 · 07 §3-15)
 *
 * T-W2-08은 주민 업로드물을 `awaiting_branch_review`까지 데려다 놓고 끝났다 — 승인/반려를 **기록하는
 * 코드가 없어** 거기서 영구 정지했다. 이 서비스가 그 승인 행위를 소유한다.
 *
 * ── 왜 T-W2-08의 서비스와 파일을 나누는가 (검수 게이트 ①의 잔존분) ──────────────
 * T-W2-08의 1차 강제는 "모듈이 큐를 모른다"였다. 승인 시 인큐가 붙으면 모듈 경계로는 그 보증이
 * 성립하지 않지만, **무인증 표면이 큐에 닿지 못한다**는 보증은 파일을 나눔으로써 그대로 남는다:
 *   · `ResidentLinksService`(무인증 3종 = 익명 주민이 도달할 수 있는 전부) — 큐 의존 **0**. 생성자에
 *     QueueProducerService가 없어 인큐 문장을 쓸 수조차 없다.
 *   · `ResidentReviewsService`(이 파일, 인증 전용) — 큐를 아는 **유일한** 자리이며, 그 유일한 인큐
 *     호출은 ⓐ 승인 CAS 기록과 ⓑ `assertPipelineEntryAllowed` 통과 **뒤에만** 실행된다.
 * 그리고 진짜 강제는 엣지 수준으로 옮겨 갔다 — `resident-review.gate.ts` 상단 주석 참조.
 *
 * ── 개인정보 (07 §3-15 · 대장 #103⑥) ────────────────────────────────────────
 * `uploaderContact`·`consentAgreedAt`는 07 §3-15가 "사후 연락 가능성 확보"와 "이용허락 클릭동의"의
 * 근거로 수집하게 한 값이다. 지금까지 **읽는 코드가 0건**이어서 수집만 하고 아무도 못 보는 상태였다.
 * 검수자가 보는 이 응답이 그 값들의 **유일한 노출 지점**이며, 무인증 표면(발급 링크 조회·업로드 영수증)은
 * 지금도 이 필드들을 싣지 않는다(T-W2-08의 화이트리스트 투영 유지).
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 검수 대기열 1건 — 인증된 지사 담당자에게만 나간다.
 * 원본 재생은 이 응답에 담지 않는다: `contentId`로 기존 경로(`GET /v1/contents/:id` 상세의 assets →
 * `GET /v1/media-assets/:id/url` 서명 URL)가 이미 열려 있고 둘 다 기자에게 **자기 지사 범위**로
 * 열려 있다(`loadReadable`·`MediaController.getUrl`). 같은 URL 발급 로직을 여기에 복제하지 않는다.
 */
export interface ResidentUploadReviewItem {
  readonly id: string;
  readonly status: ResidentUploadStatus;
  readonly stationId: string;
  readonly stationName: string;
  /** 완료 통지 시 생성된 콘텐츠 — 검수 화면의 미리보기·상세 진입점 */
  readonly contentId: string | null;
  /** 07 §3-15 ⓐ 업로더 연락처 — 검수자 전용(무인증 표면 노출 금지) */
  readonly uploaderContact: string | null;
  /** 07 §3-15 ⓑ 이용허락 클릭동의 시각. null = 동의 없이 접수된 건(검수자 판단 재료) */
  readonly consentAgreedAt: string | null;
  readonly mimeType: string;
  readonly sizeBytes: number | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
}

type ReviewRow = ResidentUploadRow & {
  link: { stationId: string; station: { name: string } };
};

const REVIEW_INCLUDE = {
  link: { select: { stationId: true, station: { select: { name: true } } } },
} as const;

/** 화이트리스트 투영 — 행을 그대로 흘리지 않는다(storageKey·linkId 등 내부 좌표 미노출) */
const toReviewItem = (row: ReviewRow): ResidentUploadReviewItem => ({
  id: row.id,
  status: row.status as ResidentUploadStatus,
  stationId: row.link.stationId,
  stationName: row.link.station.name,
  contentId: row.contentId,
  uploaderContact: row.uploaderContact,
  consentAgreedAt: row.consentAgreedAt?.toISOString() ?? null,
  mimeType: row.mimeType,
  // BigInt는 JSON 직렬화가 불가능하다(TypeError) — 경계에서 number로 내린다
  sizeBytes: row.sizeBytes == null ? null : Number(row.sizeBytes),
  completedAt: row.completedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  reviewedByUserId: row.reviewedByUserId,
  reviewedAt: row.reviewedAt?.toISOString() ?? null,
});

@Injectable()
export class ResidentReviewsService {
  private readonly logger = new Logger(ResidentReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly residentLinks: ResidentLinksService,
    private readonly producer: QueueProducerService,
    private readonly assets: MediaAssetsService,
  ) {}

  /* ────────────────────────── ① 검수 대기열 조회 ────────────────────────── */

  /**
   * 지사 경계는 **서버가 강제**한다 — 기자는 쿼리와 무관하게 자기 소속 지사만 본다.
   * 정렬은 오래된 것부터(FIFO): 검수가 밀리면 가장 오래 기다린 주민의 제보가 먼저 처리돼야 하고,
   * `@@index([status, createdAt])`가 정확히 이 조회를 위해 놓여 있다(schema.prisma 주석).
   */
  async listQueue(
    user: User,
    query: ResidentReviewQueryDto,
  ): Promise<Paginated<ResidentUploadReviewItem>> {
    const stationId = isReporterUser(user) ? user.stationId : query.stationId;
    const where: Prisma.ResidentUploadWhereInput = {
      status: query.status ?? ResidentUploadStatus.AwaitingBranchReview,
      ...(stationId ? { link: { stationId } } : {}),
    };

    const [totalCount, rows] = await this.prisma.$transaction([
      this.prisma.residentUpload.count({ where }),
      this.prisma.residentUpload.findMany({
        where,
        include: REVIEW_INCLUDE,
        orderBy: { createdAt: 'asc' },
        ...toSkipTake(query),
      }),
    ]);
    return toPaginated((rows as ReviewRow[]).map(toReviewItem), totalCount, query);
  }

  /* ────────────────────────── ② 승인 → 파이프라인 진입 ────────────────────────── */

  /**
   * 승인 = ⓐ **인큐 가능 여부 선확인** → ⓑ 검수 결정 기록(CAS) → ⓒ 게이트 통과 확인 →
   * ⓓ 트랜스코딩 인큐(인큐-애프터-커밋).
   *
   * ★ ⓐ가 ⓑ보다 먼저인 이유(비대칭 금지): 결정을 먼저 커밋하고 인큐에서 터지면 그 건은 대기열
   * (`awaiting_branch_review`)에서 **사라지는데** 콘텐츠는 `uploaded`에 남아 아무도 모르는 교착이 된다.
   * 검수자에게는 "500 서버 내부 오류"만 보이고 되돌릴 버튼도 없다(재승인은 이미 approved라 멱등 통과).
   * 그래서 인큐를 막을 수 있는 조건은 **전부 결정 기록 이전에** 본다 — 큐 가용성(`requirePipeline`)과
   * 인큐 소스(`requireEnqueueableSource`) 두 가지다. 둘 다 실패는 `DomainException`이라 검수자가
   * 무엇을 해야 하는지 아는 문구·상태코드로 나간다.
   *
   * 멱등: 같은 건을 다시 승인해도 200이고, 콘텐츠가 아직 `uploaded`면 **재인큐**한다. 잡 유실·큐 장애로
   * 승인만 남고 잡이 사라진 건을 검수자가 같은 버튼으로 복구할 수 있다(잡 id는 결정적이라 재큐 멱등).
   */
  async approve(user: User, uploadId: string): Promise<ResidentUploadReviewItem> {
    const upload = await this.loadForReview(user, uploadId);
    this.requirePipeline();
    await this.requireEnqueueableSource(upload);

    const decided = await this.decide(upload, user, ResidentUploadStatus.Approved);
    await this.enterPipeline(decided);
    return toReviewItem(decided);
  }

  /* ────────────────────────── ③ 반려 [종결] ────────────────────────── */

  /**
   * 반려는 인큐하지 않는다(파이프라인 미진입 확정). 큐 가용성도 요구하지 않는다 —
   * 07 §3-15가 "불법촬영물 의심 시 **즉시 반려**"를 관리적 조치로 요구하므로, 인프라 상태가
   * 위험 콘텐츠 차단을 막아서는 안 된다.
   *
   * 반려된 업로드의 Content는 `uploaded`에 남는다(종결 전이는 하지 않는다): 주민 콘텐츠는
   * `reporterId=null`이라 `ContentWorkflowService.cancel`의 소유 기자 판정을 통과할 수 없고,
   * 그 배선은 이 태스크의 파일 소유권 밖이다. 게이트가 영구히 막으므로 **안전하지만 정돈되지는 않은**
   * 상태이며, 후속 위임 대상이다(완료 보고 참조).
   */
  async reject(user: User, uploadId: string): Promise<ResidentUploadReviewItem> {
    const upload = await this.loadForReview(user, uploadId);
    const decided = await this.decide(upload, user, ResidentUploadStatus.Rejected);
    return toReviewItem(decided);
  }

  /* ────────────────────────── 내부 ────────────────────────── */

  private requirePipeline(): void {
    if (!this.producer.enabled) {
      throw new DomainException(
        'internal',
        'Redis 미설정 — 업로드 파이프라인이 비활성 상태입니다',
      );
    }
  }

  /**
   * ★ 인큐 소스 선확인 — `QueueProducerService.enqueueTranscode`가 인큐 직전에 요구하는 것과 **같은
   * 조건**(원본 자산 실재)을 결정 기록 **이전에** 본다. 그쪽 판정은 정상 흐름에서 도달 불가를 전제한
   * 방어 코드라 plain `Error`를 던지고(=500 "서버 내부 오류"), 여기까지 오면 이미 승인이 커밋된 뒤다.
   *
   * 도달 경로가 실재한다: 완료 통지(`ResidentLinksService.completeUpload`)의 자산 등록은 Content 생성
   * 트랜잭션 **밖**이라, 그 단계가 실패해도 `awaiting_branch_review`는 커밋된다. 그 코드는 "재전송이
   * 보정한다"를 전제하지만 **익명 업로더가 재전송하지 않으면 보정되지 않는다** — 원본 없는 검수 건이
   * 대기열에 남는다.
   *
   * 판정은 `MediaAssetsService.findOriginal`(생산자가 쓰는 그 함수)을 그대로 재사용한다 — 사본을 두면
   * 두 판정이 어긋나 선확인이 통과시킨 건이 인큐에서 다시 터진다. generation=1은 생산자 기본값과 동일.
   * 코드는 `conflict`(409): 요청이 잘못된 게 아니라 **대상의 상태**가 승인을 받을 수 없는 것이다.
   */
  private async requireEnqueueableSource(upload: ReviewRow): Promise<void> {
    if (!upload.contentId) {
      // awaiting_branch_review 편입과 Content 생성은 같은 트랜잭션이라 정상 흐름에선 도달 불가
      throw new DomainException('conflict', '업로드 완료 통지를 받지 못한 건입니다', {
        status: upload.status,
      });
    }
    const original = await this.assets.findOriginal(upload.contentId, 1);
    if (!original) {
      throw new DomainException(
        'conflict',
        '업로드된 원본 영상을 찾을 수 없어 승인할 수 없습니다 — 주민에게 다시 올려달라고 요청하거나 반려해주세요',
        { uploadId: upload.id, contentId: upload.contentId },
      );
    }
  }

  /**
   * 대상 로드 + 지사 경계. 미존재는 404, 타 지사는 403 —
   * `ContentsService.loadReadable`의 순서(존재 → 경계)를 그대로 따른다.
   */
  private async loadForReview(user: User, uploadId: string): Promise<ReviewRow> {
    const row = (await this.prisma.residentUpload.findUnique({
      where: { id: uploadId },
      include: REVIEW_INCLUDE,
    })) as ReviewRow | null;
    if (!row) throw new DomainException('not_found', '업로드를 찾을 수 없습니다');
    if (isReporterUser(user) && row.link.stationId !== user.stationId) {
      throw new DomainException('forbidden', '자기 지사에 접수된 업로드만 검수할 수 있습니다');
    }
    return row;
  }

  /**
   * 검수 결정 기록 — `awaiting_branch_review` 조건부 UPDATE(CAS)로 동시 검수 중 하나만 승리시킨다.
   * 허용 여부 판정은 모듈 전이맵(`RESIDENT_UPLOAD_STATUS_TRANSITIONS`)이 소유한다 — from 목록 하드코딩 금지.
   * 같은 결정이 이미 기록돼 있으면 **멱등 성공**이다(더블클릭·재전송·복구 재승인).
   */
  private async decide(
    upload: ReviewRow,
    user: User,
    to: ResidentUploadStatus,
  ): Promise<ReviewRow> {
    const from = upload.status as ResidentUploadStatus;
    if (from === to) return upload; // 이미 같은 결정 — 검수자·시각은 최초 결정을 보존
    if (!canTransitionResidentUpload(from, to)) {
      throw new DomainException('conflict', '지금 검수할 수 있는 상태가 아닙니다', {
        status: from,
        allowed: RESIDENT_UPLOAD_STATUS_TRANSITIONS[from],
      });
    }

    const reviewedAt = new Date();
    const res = await this.prisma.residentUpload.updateMany({
      where: { id: upload.id, status: ResidentUploadStatus.AwaitingBranchReview },
      data: { status: to, reviewedByUserId: user.id, reviewedAt },
    });
    if (res.count === 0) {
      // 경합 패배 — 승자의 결정이 내 결정과 같으면 멱등 성공, 다르면 409
      const fresh = await this.prisma.residentUpload.findUnique({ where: { id: upload.id } });
      if (fresh?.status === to) return { ...upload, ...fresh } as ReviewRow;
      throw new DomainException('conflict', '다른 검수자가 먼저 처리했습니다', {
        status: fresh?.status ?? null,
      });
    }
    return { ...upload, status: to, reviewedByUserId: user.id, reviewedAt };
  }

  /**
   * ★ 정식 파이프라인 진입 — `assertPipelineEntryAllowed`를 **반드시 경유**한다(03 §C-5 서버측 강제).
   * 승인 직후라 통과가 당연해 보이지만, 이 호출은 ⓐ CAS가 실제로 관철됐는지를 DB 재조회로 확인하고
   * ⓑ 인큐 경로가 게이트를 우회할 수 없다는 사실을 코드 위에 남긴다.
   *
   * 콘텐츠가 이미 `uploaded`를 떠났으면 재인큐하지 않는다 — 진행 중이거나 이미 끝난 콘텐츠를 다시
   * 트랜스코딩하면 현 세대 산출물을 덮어쓴다.
   */
  private async enterPipeline(upload: ReviewRow): Promise<void> {
    if (!upload.contentId) {
      // 여기 도달 전에 requireEnqueueableSource가 이미 걸렀다(결정 기록 이전). 남겨 두는 이유는
      // 타입 좁히기 + 이 private 메서드가 다른 곳에서 불릴 때의 방어이며, 문구·코드는 그쪽과 같다.
      throw new DomainException('conflict', '업로드 완료 통지를 받지 못한 건입니다', {
        status: upload.status,
      });
    }
    await this.residentLinks.assertPipelineEntryAllowed(upload.contentId);

    const content = await this.prisma.content.findUnique({ where: { id: upload.contentId } });
    if (!content) throw new DomainException('not_found', '콘텐츠를 찾을 수 없습니다');
    if (content.status !== 'uploaded') {
      this.logger.log(
        `주민 업로드 재승인 — 이미 파이프라인에 진입해 재인큐 생략 (contentId=${content.id}, status=${content.status})`,
      );
      return;
    }
    await this.producer.enqueueTranscode(content);
  }
}
